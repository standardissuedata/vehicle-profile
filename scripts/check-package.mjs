import assert from 'node:assert/strict';
import {accessSync, constants, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const scratch = mkdtempSync(join(tmpdir(), 'vehicle-profile-package-'));

function run(args, cwd) {
  const result = spawnSync(process.execPath, args, {
    cwd, encoding: 'utf8', timeout: 120_000,
    env: {...process.env, npm_config_cache: join(scratch, 'npm-cache')},
  });
  if (result.error) throw result.error;
  assert.equal(result.status, 0, result.stdout + result.stderr);
  return result.stdout;
}

try {
  assert.ok(process.env.npm_execpath, 'Run this check with npm run test:package.');
  const [packed] = JSON.parse(run([
    process.env.npm_execpath, 'pack', '--json', '--pack-destination', scratch,
  ], root));
  assert.equal(packed.name, '@standardissuedata/vehicle-profile');
  assert.equal(packed.version, manifest.version);
  for (const entry of packed.files) {
    assert.match(entry.path, /^(?:dist\/[^/]+\.(?:js|d\.ts)|bin\/vehicle-profile\.mjs|package\.json|README\.md|CHANGELOG\.md|LICENSE)$/);
  }
  assert.ok(packed.files.some(entry => entry.path === 'CHANGELOG.md'));

  run([
    process.env.npm_execpath, 'install', '--offline', '--ignore-scripts', '--no-audit', '--no-fund',
    '--prefix', scratch, join(scratch, packed.filename),
  ], root);
  const installed = join(scratch, 'node_modules', '@standardissuedata', 'vehicle-profile');
  const installedManifest = JSON.parse(readFileSync(join(installed, 'package.json'), 'utf8'));
  assert.equal(installedManifest.name, manifest.name);
  assert.equal(installedManifest.version, manifest.version);
  assert.equal(installedManifest.license, 'MIT');
  assert.equal(installedManifest.publishConfig.access, 'public');
  assert.equal(installedManifest.repository.url, 'git+https://github.com/standardissuedata/vehicle-profile.git');
  assert.equal(Object.keys(installedManifest.dependencies ?? {}).length, 0);
  assert.ok(existsSync(join(installed, installedManifest.exports['.'].types)));
  assert.ok(existsSync(join(scratch, 'node_modules', '.bin', 'vehicle-profile')));

  const fixtures = JSON.parse(readFileSync(join(root, 'test/fixtures/release-regressions.json'), 'utf8'));
  writeFileSync(join(scratch, 'fixtures.json'), JSON.stringify(fixtures));
  writeFileSync(join(scratch, 'verify.mjs'), `
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {lookupVehicle, validateVin} from '@standardissuedata/vehicle-profile';
const fixtures = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url), 'utf8'));
const vin = '1G1RA6S52HU145814';
assert.equal(validateVin(vin).vin, vin);
const result = await lookupVehicle(vin, {fetch: async url => {
  if (url.hostname === 'vpic.nhtsa.dot.gov') return Response.json(fixtures.voltIdentity);
  if (url.hostname === 'www.fueleconomy.gov') {
    if (url.pathname.endsWith('/menu/model')) return Response.json({menuItem: {value: 'Volt'}});
    if (url.pathname.endsWith('/menu/options')) return Response.json({menuItem: {value: '37309'}});
    assert.equal(url.pathname, '/ws/rest/vehicle/37309');
    return Response.json(fixtures.voltEpa);
  }
  if (url.pathname.startsWith('/SafetyRatings/')) return Response.json({Results: []});
  if (url.pathname.startsWith('/recalls/') || url.pathname.startsWith('/complaints/')) return Response.json({results: []});
  throw new Error('Unexpected fixture request ' + url);
}});
assert.equal(result.version, 1);
assert.equal(result.fuelEconomy.status, 'ok');
assert.equal(result.fuelEconomy.records[0].id, '37309');
assert.equal(result.fuelEconomy.records[0].combined, 42);
assert.equal(result.fuelEconomy.records[0].secondary.combined, 106);
assert.equal(result.fuelEconomy.records[0].electricRangeMiles, 53);
`);
  run([join(scratch, 'verify.mjs')], scratch);
  writeFileSync(join(scratch, 'consumer.mts'), `
import {lookupVehicle, validateVin, type Drive, type VehicleProfile} from '@standardissuedata/vehicle-profile';
const drive: Drive = 'awd_or_4wd';
const vin: string = validateVin('1G1RA6S52HU145814').vin;
const profile: VehicleProfile = await lookupVehicle(vin, {timeoutMs: 1000});
const units: 'mpg' | 'mpge' | undefined = profile.fuelEconomy.records[0]?.units;
void [drive, units];
`);
  run([
    join(root, 'node_modules/typescript/bin/tsc'), '--strict', '--noEmit', '--module', 'NodeNext',
    '--target', 'ES2022', '--lib', 'ES2022,DOM', join(scratch, 'consumer.mts'),
  ], scratch);

  const cli = join(installed, 'bin', 'vehicle-profile.mjs');
  accessSync(cli, constants.X_OK);
  assert.match(run([cli, '--help'], scratch), /Usage: vehicle-profile <VIN>/);
  const invalid = spawnSync(process.execPath, [cli, 'invalid'], {cwd: scratch, encoding: 'utf8', timeout: 10_000});
  if (invalid.error) throw invalid.error;
  assert.equal(invalid.status, 2);
  assert.match(invalid.stderr, /17-character VIN/);
  assert.equal(invalid.stdout, '');
  console.log(`${manifest.name}@${manifest.version}: tarball contents, offline install, public exports, TypeScript consumer and CLI checks passed on ${process.version}.`);
} finally {
  rmSync(scratch, {recursive: true, force: true});
}
