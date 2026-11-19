import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import test from 'node:test';
import {lookupVehicle} from '../dist/index.js';
import {lookupFuelEconomy} from '../dist/fuel-economy.js';
import {driveType, lookupIdentity, sameDrive} from '../dist/identity.js';
import {lookupComplaints, lookupRecalls, lookupRatings} from '../dist/safety.js';

const fixtures = JSON.parse(readFileSync(new URL('./fixtures/release-regressions.json', import.meta.url), 'utf8'));
const vehicle = overrides => ({
  year: 2024, make: 'TOYOTA', model: 'Camry', trim: null, bodyClass: null,
  doors: null, cabType: null, drive: null, cylinders: null,
  displacementLiters: null, fuel: null, electrification: null, ...overrides,
});

function epaGetter(rows) {
  return async url => {
    if (url.pathname.endsWith('/menu/model')) return {menuItem: rows.map(row => ({value: row.model}))};
    if (url.pathname.endsWith('/menu/options')) return {
      menuItem: rows.filter(row => row.model === url.searchParams.get('model')).map(row => ({value: String(row.id)})),
    };
    const row = rows.find(row => url.pathname === '/ws/rest/vehicle/' + row.id);
    assert.ok(row, 'Unexpected fixture request ' + url);
    return row;
  };
}

test('complaint month/day dates and recall day/month dates normalize independently', async () => {
  const complaints = await lookupComplaints(vehicle({}), async () => fixtures.complaints);
  assert.deepEqual(complaints.records.map(row => row.filedOn), ['2026-11-03', '2026-10-16', '2026-10-03']);
  const recalls = await lookupRecalls(vehicle({}), async () => fixtures.recalls);
  assert.equal(recalls.records[0].reportedOn, '2024-02-22');
});

test('invalid calendar dates are null while leap days remain valid', async () => {
  const complaints = await lookupComplaints(vehicle({}), async () => ({results: [
    {dateComplaintFiled: '02/29/2024'}, {dateComplaintFiled: '02/29/2025'},
    {dateComplaintFiled: '04/31/2026'}, {dateComplaintFiled: '13/01/2026'}, {dateComplaintFiled: ''},
  ]}));
  assert.deepEqual(complaints.records.map(row => row.filedOn), ['2024-02-29', null, null, null, null]);
  const recalls = await lookupRecalls(vehicle({}), async () => ({results: [
    {ReportReceivedDate: '29/02/2024'}, {ReportReceivedDate: '29/02/2025'}, {ReportReceivedDate: '31/04/2026'},
  ]}));
  assert.deepEqual(recalls.records.map(row => row.reportedOn), ['2024-02-29', null, null]);
});

test('public lookup preserves Volt PHEV ratings when source fuel order differs', async () => {
  const getEpa = epaGetter([fixtures.voltEpa]);
  const profile = await lookupVehicle('1G1RA6S52HU145814', {fetch: async url => {
    if (url.hostname === 'vpic.nhtsa.dot.gov') return Response.json(fixtures.voltIdentity);
    if (url.hostname === 'www.fueleconomy.gov') return Response.json(await getEpa(url));
    if (url.pathname.startsWith('/SafetyRatings/')) return Response.json({Results: []});
    if (url.pathname.startsWith('/recalls/') || url.pathname.startsWith('/complaints/')) return Response.json({results: []});
    throw new Error('Unexpected fixture request ' + url);
  }});
  assert.equal(profile.identity.vehicle.fuel, 'Electric');
  assert.equal(profile.fuelEconomy.status, 'ok');
  const [record] = profile.fuelEconomy.records;
  assert.equal(record.id, '37309');
  assert.equal(record.combined, 42);
  assert.equal(record.units, 'mpg');
  assert.equal(record.secondary.combined, 106);
  assert.equal(record.secondary.units, 'mpge');
  assert.equal(record.electricRangeMiles, 53);
});

test('known PHEV, BEV, HEV and combustion identities reject contradictory powertrains', async () => {
  const decoded = await lookupIdentity('1G1RA6S52HU145814', async () => fixtures.voltIdentity);
  const rows = [
    fixtures.voltEpa,
    {...fixtures.voltEpa, id: '90001', fuelType1: 'Regular Gasoline', fuelType2: '', atvType: 'Hybrid'},
    {...fixtures.voltEpa, id: '90002', fuelType1: 'Regular Gasoline', fuelType2: '', atvType: ''},
    {...fixtures.voltEpa, id: '90003', fuelType1: 'Electricity', fuelType2: '', atvType: 'EV', cylinders: '', displ: ''},
    {...fixtures.voltEpa, id: '90004', fuelType1: 'Diesel', fuelType2: '', atvType: 'Diesel'},
  ];
  for (const [electrification, fuel, id] of [
    ['PHEV (Plug-in Hybrid Electric Vehicle)', 'Electric', '37309'],
    ['BEV (Battery Electric Vehicle)', 'Electric', '90003'],
    ['HEV (Hybrid Electric Vehicle)', 'Gasoline', '90001'],
    ['Not Electrified', 'Gasoline', '90002'],
  ]) {
    const result = await lookupFuelEconomy({...decoded.vehicle, electrification, fuel}, epaGetter(rows));
    assert.deepEqual(result.records.map(row => row.id), [id], electrification);
  }
});

test('PHEV matching accepts either source fuel order and missing EPA type labels', async () => {
  const decoded = await lookupIdentity('1G1RA6S52HU145814', async () => fixtures.voltIdentity);
  for (const [fuel, row] of [
    ['Gasoline', fixtures.voltEpa],
    ['Gasoline', {...fixtures.voltEpa, fuelType1: 'Electricity', fuelType2: 'Regular Gasoline', atvType: ''}],
    ['Diesel', {...fixtures.voltEpa, fuelType1: 'Diesel', fuelType2: 'Electricity', atvType: ''}],
  ]) {
    const result = await lookupFuelEconomy({...decoded.vehicle, fuel}, epaGetter([row]));
    assert.deepEqual(result.records.map(row => row.id), ['37309']);
  }
});

test('legacy EPA combined drive accepts 4WD Wrangler without claiming AWD', async () => {
  const result = await lookupFuelEconomy(vehicle({
    year: 2008, make: 'JEEP', model: 'Wrangler', drive: '4wd',
    fuel: 'Gasoline', cylinders: 6, displacementLiters: 3.8,
  }), epaGetter([fixtures.jeepEpa]));
  assert.equal(result.status, 'ok');
  assert.equal(result.records[0].id, '24669');
  assert.equal(result.records[0].drive, 'awd_or_4wd');
});

test('combined drive accepts AWD or 4WD symmetrically and excludes two-wheel drive', () => {
  const combined = driveType('4-Wheel or All-Wheel Drive');
  assert.equal(combined, 'awd_or_4wd');
  for (const drive of ['awd', '4wd']) {
    assert.equal(sameDrive(drive, combined), true);
    assert.equal(sameDrive(combined, drive), true);
  }
  for (const drive of ['fwd', 'rwd', '2wd']) {
    assert.equal(sameDrive(drive, combined), false);
    assert.equal(sameDrive(combined, drive), false);
  }
  assert.equal(sameDrive('awd', '4wd'), false);
  assert.equal(sameDrive('4wd', 'awd'), false);
});

test('CNG Civic uses MPGe and excludes a gasoline-only configuration', async () => {
  const result = await lookupFuelEconomy(vehicle({
    year: 2014, make: 'HONDA', model: 'Civic', drive: 'fwd',
    fuel: 'Compressed Natural Gas (CNG)', cylinders: 4, displacementLiters: 1.8,
  }), epaGetter([
    fixtures.cngEpa,
    {...fixtures.cngEpa, id: '90005', fuelType1: 'Regular Gasoline', atvType: ''},
  ]));
  assert.equal(result.status, 'ok');
  const [record] = result.records;
  assert.equal(record.id, '34728');
  assert.equal(record.combined, 31);
  assert.equal(record.units, 'mpge');
  assert.equal(record.electricRangeMiles, null);
});

test('secondary CNG uses MPGe while liquid fuels retain MPG and no electric range', async () => {
  const rows = [
    {...fixtures.cngEpa, id: '90006', model: 'Civic Bifuel', fuelType1: 'Regular Gasoline', fuelType2: 'Natural Gas',
      atvType: 'Bifuel (CNG)', combA08: '30', rangeA: '200'},
    {...fixtures.cngEpa, id: '90007', model: 'Civic FFV', fuelType1: 'Regular Gasoline', fuelType2: 'E85',
      atvType: 'FFV', combA08: '22', rangeA: '250'},
  ];
  const result = await lookupFuelEconomy(vehicle({year: 2014, make: 'HONDA', model: 'Civic', fuel: 'Gasoline'}), epaGetter(rows));
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.records.map(row => [row.units, row.secondary.units, row.electricRangeMiles]), [
    ['mpg', 'mpge', null], ['mpg', 'mpg', null],
  ]);
});

function silveradoGetter(calls) {
  return async url => {
    calls.push(url.pathname);
    const id = /\/VehicleId\/(\d+)$/.exec(url.pathname)?.[1];
    if (id) {
      assert.ok(fixtures.silveradoDetails[id], 'Unexpected fixture request ' + url);
      return fixtures.silveradoDetails[id];
    }
    return fixtures.silveradoCandidates;
  };
}

test('known Silverado cab filters direct candidates before requesting detail ratings', async () => {
  for (const [cabType, id, stars] of [
    ['Crew/Super Crew/Crew Max', 14385, 4], ['Extended Cab', 14383, 5], ['Regular Cab', 14381, 5],
  ]) {
    const calls = [];
    const result = await lookupRatings(vehicle({
      year: 2020, make: 'CHEVROLET', model: 'Silverado 1500', drive: '4wd', doors: 4, cabType,
    }), silveradoGetter(calls));
    assert.equal(result.status, 'ok');
    assert.deepEqual(result.records.map(row => [row.id, row.overall]), [[id, stars]]);
    assert.deepEqual(calls.filter(path => path.includes('/VehicleId/')), ['/SafetyRatings/VehicleId/' + id]);
  }
});

test('unknown Silverado cab preserves all compatible cabs as ambiguous', async () => {
  const result = await lookupRatings(vehicle({
    year: 2020, make: 'CHEVROLET', model: 'Silverado 1500', drive: '4wd',
  }), silveradoGetter([]));
  assert.equal(result.status, 'ambiguous');
  assert.deepEqual(result.records.map(row => row.id), [14385, 14383, 14381]);
});
