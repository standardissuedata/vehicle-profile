import assert from 'node:assert/strict';
import test from 'node:test';
import {lookupVehicle, validateVin} from '../dist/index.js';

const vin = '4T1K61AK7RU219133';
const vinRow = {
  ModelYear: '2024', Make: 'TOYOTA', Model: 'Camry', Trim: 'XSE',
  Doors: '4', DriveType: '4x2', EngineCylinders: '4', DisplacementL: '2.5',
  FuelTypePrimary: 'Gasoline', ErrorCode: '0',
};
const configs = [
  {id: 47087, model: 'Camry XSE', cylinders: 6, displ: 3.5, drive: 'Front-Wheel Drive', comb08: 26},
  {id: 47091, model: 'Camry XLE/XSE', cylinders: 4, displ: 2.5, drive: 'Front-Wheel Drive', comb08: 31},
  {id: 47093, model: 'Camry Hybrid SE/XLE/XSE', cylinders: 4, displ: 2.5, drive: 'Front-Wheel Drive', comb08: 46},
  {id: 47088, model: 'Camry AWD XLE/XSE', cylinders: 4, displ: 2.5, drive: 'All-Wheel Drive', comb08: 28},
];

function fakeFetch({identity = vinRow, vehicleConfigs = configs, failComplaints = false} = {}) {
  const calls = [];
  const expected = new Map([
    ['/api/vehicles/DecodeVinValues/' + vin, {Results: [identity]}],
    ['/recalls/recallsByVehicle', {results: [{NHTSACampaignNumber: '24V128000'}]}],
    ['/complaints/complaintsByVehicle', {results: [{odiNumber: 11775517}]}],
    ['/SafetyRatings/modelyear/2024/make/TOYOTA/model/Camry', {Results: [
      {VehicleId: 19427, VehicleDescription: '2024 Toyota CAMRY 4 DR AWD'},
      {VehicleId: 19426, VehicleDescription: '2024 Toyota CAMRY 4 DR FWD'},
    ]}],
    ['/SafetyRatings/VehicleId/19426', {Results: [{VehicleId: 19426, OverallRating: '5'}]}],
    ['/ws/rest/vehicle/menu/model', {menuItem: vehicleConfigs.map(row => ({value: row.model}))}],
  ]);
  const fetch = async (url) => {
    calls.push(url.pathname);
    if (failComplaints && url.pathname.includes('/complaints/')) return new Response('', {status: 503});
    const known = expected.get(url.pathname);
    if (known) return Response.json(known);
    if (url.pathname === '/ws/rest/vehicle/menu/options') {
      const row = vehicleConfigs.find(config => config.model === url.searchParams.get('model'));
      if (row) return Response.json({menuItem: {text: '', value: String(row.id)}});
    }
    const config = vehicleConfigs.find(row => url.pathname === '/ws/rest/vehicle/' + row.id);
    if (config) return Response.json({...config, fuelType1: 'Regular Gasoline'});
    throw new Error('Unexpected fixture request ' + url);
  };
  return {calls, fetch};
}

test('normalizes a valid VIN and validates syntax and the North American check digit', () => {
  assert.deepEqual(validateVin(' ' + vin.toLowerCase() + ' '), {vin, northAmericanCheckDigitValid: true});
  assert.equal(validateVin('4T1K61AK0RU219133').northAmericanCheckDigitValid, false);
  assert.throws(() => validateVin('4T1K61AKQRU219133'), RangeError);
});

test('Camry XSE excludes the V6 and AWD records and preserves hybrid ambiguity', async () => {
  const {fetch, calls} = fakeFetch();
  const result = await lookupVehicle(vin, {fetch});
  assert.equal(result.identity.vehicle.cylinders, 4);
  assert.equal(result.recalls.scope, 'year_make_model');
  assert.equal(result.recalls.records[0].campaignId, '24V128000');
  assert.equal(result.complaints.records.length, 1);
  assert.equal(result.safetyRatings.scope, 'configuration');
  assert.equal(result.safetyRatings.records[0].overall, 5);
  assert.ok(!calls.includes('/SafetyRatings/VehicleId/19427'));
  assert.equal(result.fuelEconomy.status, 'ambiguous');
  assert.deepEqual(result.fuelEconomy.records.map(row => row.combined), [31, 46]);
});

test('never returns the V6 as a fallback when it is the only candidate', async () => {
  const {fetch} = fakeFetch({vehicleConfigs: configs.slice(0, 1)});
  const {fuelEconomy} = await lookupVehicle(vin, {fetch});
  assert.equal(fuelEconomy.status, 'no_records');
  assert.deepEqual(fuelEconomy.records, []);
});

test('upstream failure leaves other sections usable', async () => {
  const {fetch} = fakeFetch({failComplaints: true});
  const result = await lookupVehicle(vin, {fetch});
  assert.equal(result.complaints.status, 'unavailable');
  assert.equal(result.recalls.status, 'ok');
  assert.equal(result.fuelEconomy.status, 'ambiguous');
});

test('partial VIN identity leaves dependent sections unqueried', async () => {
  const {fetch, calls} = fakeFetch({identity: {Make: 'TOYOTA', ErrorCode: '7'}});
  const result = await lookupVehicle(vin, {fetch});
  assert.equal(result.identity.status, 'partial');
  assert.equal(result.recalls.status, 'missing_identity');
  assert.equal(result.fuelEconomy.status, 'missing_identity');
  assert.deepEqual(calls, ['/api/vehicles/DecodeVinValues/' + vin]);
});

test('finds the F-150 under the spelling and cab labels used by each source', async () => {
  const truckVin = '1FTEW1E43LKF44586';
  const calls = [];
  const responses = new Map([
    ['/api/vehicles/DecodeVinValues/' + truckVin, {Results: [{
      ModelYear: '2020', Make: 'FORD', Model: 'F-150', CabType: 'Crew/Super Crew/Crew Max',
      DriveType: '4WD', EngineCylinders: '6', DisplacementL: '3.5', FuelTypePrimary: 'Gasoline',
    }]}],
    ['/recalls/recallsByVehicle', {results: []}],
    ['/complaints/complaintsByVehicle', {results: []}],
    ['/SafetyRatings/modelyear/2020/make/FORD/model/F-150', {Results: []}],
    ['/SafetyRatings/modelyear/2020/make/FORD', {Results: [
      {Model: 'F-150 REGULAR CAB'}, {Model: 'F-150 SUPER CREW'}, {Model: 'F-150 SUPER CREW DIESEL'},
    ]}],
    ['/SafetyRatings/modelyear/2020/make/FORD/model/F-150%20SUPER%20CREW', {Results: [
      {VehicleId: 21, VehicleDescription: '2020 Ford F-150 Super Crew PU/CC 4WD'},
    ]}],
    ['/SafetyRatings/VehicleId/21', {Results: [{VehicleId: 21, OverallRating: '5'}]}],
    ['/ws/rest/vehicle/menu/model', {menuItem: {value: 'F150 Pickup 4WD'}}],
    ['/ws/rest/vehicle/menu/options', {menuItem: {value: '22'}}],
    ['/ws/rest/vehicle/22', {id: 22, model: 'F150 Pickup 4WD', cylinders: 6, displ: 3.5,
      drive: '4-Wheel Drive', fuelType1: 'Regular Gasoline', comb08: 18}],
  ]);
  const result = await lookupVehicle(truckVin, {fetch: async (url) => {
    calls.push(url.pathname);
    if (!responses.has(url.pathname)) throw new Error('Unexpected fixture request ' + url);
    return Response.json(responses.get(url.pathname));
  }});
  assert.equal(result.safetyRatings.records[0].overall, 5);
  assert.ok(!calls.some(path => /CAB|DIESEL/.test(path)));
  assert.equal(result.fuelEconomy.records[0].drive, '4wd');
  assert.equal(result.fuelEconomy.records[0].combined, 18);
});
