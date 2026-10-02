<?php
// CGC Live Translation: the translation proxy, cgcmultimedia.com/live/api/translate.php.
//
// The console sends each heard line here; this file sends it to Google Cloud
// Translation (Basic, v2) with the API key, which therefore never appears in
// a web page. It answers only signed-in console operators, and stops before
// the month's free allowance runs out.
//
// This hosting account serves other websites under the same user, so the
// file is deliberately small and strict: JSON POST only, a size cap, no
// files written inside public_html, the key and state kept in the home
// folder, and errors that never echo a secret.
//
// Who counts as an operator is decided by Firebase, not here: the console's
// sign-in token is used to read operators/<uid> from the database, which the
// rules allow only for that same signed-in account. A forged or expired token
// fails that read. A good answer is remembered for ten minutes so a sermon
// doesn't make a Firebase round trip per line.
declare(strict_types=1);

const MAX_BODY = 16384;
const MAX_CHARS = 1500;          // one caption line, with room to spare
const LANGS = ['en', 'zh-CN'];
const TOKEN_CACHE_SECONDS = 600;
const HTTP_TIMEOUT = 8;
// Google bills by the calendar month, Pacific time.
const BILLING_TZ = 'America/Los_Angeles';

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');

function respond(array $data): never {
  echo json_encode(['ok' => true] + $data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

function fail(int $status, string $code, string $message): never {
  http_response_code($status);
  echo json_encode(['ok' => false, 'code' => $code, 'message' => $message], JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
  exit;
}

// ---- settings ----------------------------------------------------------------

// The settings file and the small state files sit in the hosting account's
// home folder, the parent of public_html, so no web address can reach them,
// however deep this file is uploaded.
function home_dir(): string {
  $dir = str_replace('\\', '/', __DIR__);
  $at = strpos($dir, '/public_html/');
  if ($at === false) fail(500, 'not_configured', 'translate.php must be uploaded inside public_html.');
  return substr($dir, 0, $at);
}

function config(): array {
  static $config = null;
  if ($config !== null) return $config;
  $path = home_dir() . '/cgc-live-config.php';
  if (!is_file($path)) fail(500, 'not_configured', 'Live translation is not set up yet: its settings file is missing.');
  $config = require $path;
  if (!is_array($config)) fail(500, 'not_configured', 'The live translation settings file is not readable.');
  $key = (string) ($config['google_api_key'] ?? '');
  if ($key === '' || str_starts_with($key, 'PASTE-')) fail(500, 'not_configured', 'The Google API key has not been typed into the settings file yet.');
  $db = rtrim((string) ($config['firebase_database_url'] ?? ''), '/');
  if (!preg_match('~^https://[a-z0-9.-]+\.(firebaseio\.com|firebasedatabase\.app)$~', $db)) fail(500, 'not_configured', 'The Firebase database address in the settings file is missing or wrong.');
  $project = (string) ($config['firebase_project_id'] ?? '');
  if (!preg_match('~^[a-z0-9-]{4,40}$~', $project)) fail(500, 'not_configured', 'The Firebase project ID in the settings file is missing or wrong.');
  $config['firebase_database_url'] = $db;
  $config['month_limit'] = max(0, (int) ($config['month_limit'] ?? 490000));
  return $config;
}

function state_dir(): string {
  $dir = home_dir() . '/cgc-live-state';
  if (!is_dir($dir) && !@mkdir($dir, 0700) && !is_dir($dir)) fail(500, 'storage', 'The translation proxy could not create its state folder.');
  return $dir;
}

// Read, change and write one small JSON file under a lock.
function with_json_file(string $name, callable $change): mixed {
  $path = state_dir() . '/' . $name;
  $fh = @fopen($path, 'c+');
  if ($fh === false) fail(500, 'storage', 'The translation proxy could not open its state file.');
  try {
    flock($fh, LOCK_EX);
    $raw = stream_get_contents($fh);
    $data = json_decode($raw === false || $raw === '' ? '{}' : $raw, true);
    if (!is_array($data)) $data = [];
    [$data, $result] = $change($data);
    ftruncate($fh, 0);
    rewind($fh);
    fwrite($fh, json_encode($data, JSON_UNESCAPED_SLASHES));
    fflush($fh);
    return $result;
  } finally {
    flock($fh, LOCK_UN);
    fclose($fh);
  }
}

// ---- outgoing requests -------------------------------------------------------

function http(string $method, string $url, array $headers = [], ?string $body = null): array {
  if (function_exists('curl_init')) {
    $ch = curl_init($url);
    curl_setopt_array($ch, [
      CURLOPT_CUSTOMREQUEST => $method,
      CURLOPT_RETURNTRANSFER => true,
      CURLOPT_HTTPHEADER => $headers,
      CURLOPT_TIMEOUT => HTTP_TIMEOUT,
      CURLOPT_CONNECTTIMEOUT => 4,
      CURLOPT_FOLLOWLOCATION => false,
    ]);
    if ($body !== null) curl_setopt($ch, CURLOPT_POSTFIELDS, $body);
    $text = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    return [$text === false ? 0 : $status, $text === false ? '' : (string) $text];
  }
  $ctx = stream_context_create(['http' => [
    'method' => $method, 'header' => implode("\r\n", $headers), 'content' => $body ?? '',
    'timeout' => HTTP_TIMEOUT, 'ignore_errors' => true, 'follow_location' => 0,
  ]]);
  $text = @file_get_contents($url, false, $ctx);
  $status = 0;
  foreach ($http_response_header ?? [] as $h) if (preg_match('~^HTTP/\S+ (\d{3})~', $h, $m)) $status = (int) $m[1];
  return [$status, $text === false ? '' : $text];
}

// ---- who is asking -----------------------------------------------------------

function b64url_json(string $part): ?array {
  $raw = base64_decode(strtr($part, '-_', '+/') . str_repeat('=', (4 - strlen($part) % 4) % 4), true);
  $data = $raw === false ? null : json_decode($raw, true);
  return is_array($data) ? $data : null;
}

function require_operator(string $token): void {
  $c = config();
  $parts = explode('.', $token);
  $claims = count($parts) === 3 ? b64url_json($parts[1]) : null;
  // These checks only reject junk early. The real check is Firebase
  // accepting the token below; nothing here trusts the claims by itself.
  if (!$claims) fail(401, 'signed_out', 'The console is not signed in. Reload it and sign in again.');
  $uid = (string) ($claims['sub'] ?? '');
  if (($claims['aud'] ?? '') !== $c['firebase_project_id'] || ($claims['iss'] ?? '') !== 'https://securetoken.google.com/' . $c['firebase_project_id'] || !preg_match('~^[A-Za-z0-9]{1,128}$~', $uid)) {
    fail(401, 'signed_out', 'The console’s sign-in is for a different Firebase project.');
  }
  $exp = (int) ($claims['exp'] ?? 0);
  if ($exp <= time()) fail(401, 'signed_out', 'The console’s sign-in has expired. Reload it.');

  $hash = hash('sha256', $token);
  $known = with_json_file('operators-seen.json', function (array $seen) use ($hash) {
    $now = time();
    foreach ($seen as $k => $until) if ($until <= $now) unset($seen[$k]);
    return [$seen, isset($seen[$hash])];
  });
  if ($known) return;

  [$status, $body] = http('GET', $c['firebase_database_url'] . '/operators/' . $uid . '.json?auth=' . rawurlencode($token));
  if ($status === 401 || $status === 403) fail(403, 'not_operator', 'This account is not allowed to run captions.');
  if ($status !== 200) fail(502, 'firebase_unreachable', 'Couldn’t check the operator account with Firebase (' . ($status ?: 'no answer') . ').');
  if (trim($body) !== 'true') fail(403, 'not_operator', 'This account is not listed under operators in the Firebase database.');

  with_json_file('operators-seen.json', function (array $seen) use ($hash, $exp) {
    $seen[$hash] = min($exp, time() + TOKEN_CACHE_SECONDS);
    return [$seen, null];
  });
}

// ---- the request -------------------------------------------------------------

if (($_SERVER['REQUEST_METHOD'] ?? '') !== 'POST') fail(405, 'method', 'POST only.');
// The console is on this same site; a page anywhere else has no business here.
$origin = $_SERVER['HTTP_ORIGIN'] ?? '';
if ($origin !== '' && parse_url($origin, PHP_URL_HOST) !== ($_SERVER['HTTP_HOST'] ?? '')) fail(403, 'origin', 'Not from this site.');

$raw = file_get_contents('php://input', false, null, 0, MAX_BODY + 1);
if ($raw === false || strlen($raw) > MAX_BODY) fail(413, 'too_big', 'That request is too large.');
$req = json_decode($raw, true);
if (!is_array($req)) fail(400, 'bad_request', 'Expected a JSON body.');

$text = trim((string) ($req['text'] ?? ''));
$source = (string) ($req['source'] ?? '');
$target = (string) ($req['target'] ?? '');
$token = (string) ($req['idToken'] ?? '');
if ($text === '') fail(400, 'bad_request', 'Nothing to translate.');
if (!in_array($source, LANGS, true) || !in_array($target, LANGS, true) || $source === $target) fail(400, 'bad_request', 'Unsupported languages.');
$chars = function_exists('mb_strlen') ? mb_strlen($text, 'UTF-8') : preg_match_all('/./su', $text);
if ($chars > MAX_CHARS) fail(400, 'too_long', 'That line is too long to translate in one go.');

require_operator($token);

$c = config();
$month = (new DateTimeImmutable('now', new DateTimeZone(BILLING_TZ)))->format('Y-m');
$used = with_json_file('usage.json', fn(array $u) => [$u, ($u['month'] ?? '') === $month ? (int) ($u['chars'] ?? 0) : 0]);
if ($used + $chars > $c['month_limit']) {
  fail(429, 'monthly_limit', 'This month’s translation allowance (' . number_format($c['month_limit']) . ' characters) is used up, so lines are no longer sent to Google. It resets on the 1st.');
}

[$status, $body] = http('POST', 'https://translation.googleapis.com/language/translate/v2',
  ['Content-Type: application/json; charset=utf-8', 'X-Goog-Api-Key: ' . $c['google_api_key']],
  json_encode(['q' => $text, 'source' => $source, 'target' => $target, 'format' => 'text'], JSON_UNESCAPED_UNICODE));
$g = json_decode($body, true);
if ($status !== 200 || !isset($g['data']['translations'][0]['translatedText'])) {
  // Google's own message is the useful part ("API key not valid", "API has
  // not been used in project ..."). It never contains the key.
  $why = is_array($g) && isset($g['error']['message']) ? substr((string) $g['error']['message'], 0, 300) : 'no answer';
  fail(502, 'google_error', 'Google Translate answered ' . ($status ?: 'nothing') . ': ' . $why);
}
$translated = trim((string) $g['data']['translations'][0]['translatedText']);

$total = with_json_file('usage.json', function (array $u) use ($month, $chars) {
  $now = ($u['month'] ?? '') === $month ? (int) ($u['chars'] ?? 0) : 0;
  $u = ['month' => $month, 'chars' => $now + $chars];
  return [$u, $u['chars']];
});

respond(['text' => $translated, 'usage' => ['month' => $month, 'chars' => $total, 'limit' => $c['month_limit']]]);
