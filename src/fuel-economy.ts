import {driveType, modelLabel, sameDrive, type Vehicle} from './identity.js';
import {asObject, asRows, endpoint, inBatches, number, section, string, type GetJson, type Row} from './upstream.js';

const EPA = 'https://www.fueleconomy.gov';
const DOCS = new URL('/feg/ws/', EPA);

function menuItems(value: unknown): Row[] {
  if (value === undefined) return [];
  return Array.isArray(value) ? asRows(value) : [asObject(value)];
}

function mentionsTrim(name: string, trim: string): boolean {
  return ` ${modelLabel(name)} `.includes(` ${modelLabel(trim)} `);
}

function fuelType(value: string | null): string | null {
  if (!value) return null;
  if (/electric/i.test(value)) return 'electric';
  if (/diesel/i.test(value)) return 'diesel';
  if (/gasoline/i.test(value)) return 'gasoline';
  if (/hydrogen/i.test(value)) return 'hydrogen';
  if (/\bnatural gas\b|\bCNG\b/i.test(value)) return 'cng';
  if (/propane|\bLPG\b/i.test(value)) return 'lpg';
  return null;
}

function electrification(value: string | null): 'phev' | 'hev' | 'bev' | 'none' | null {
  if (!value) return null;
  if (/\bPHEV\b|plug[- ]in hybrid/i.test(value)) return 'phev';
  if (/\bBEV\b|battery electric|^EV$/i.test(value)) return 'bev';
  if (/\bM?HEV\b|\bhybrid\b/i.test(value)) return 'hev';
  if (/not electrified|^no$/i.test(value)) return 'none';
  return null;
}

function units(value: string | null): 'mpg' | 'mpge' {
  const fuel = fuelType(value);
  return fuel === 'electric' || fuel === 'cng' ? 'mpge' : 'mpg';
}

function compatible(vehicle: Vehicle, row: Row): boolean {
  const cylinders = number(row.cylinders);
  const displacement = number(row.displ);
  const fuels = [fuelType(string(row.fuelType1)), fuelType(string(row.fuelType2))];
  const drive = driveType(string(row.drive));
  if (!sameDrive(vehicle.drive, drive)) return false;
  if (vehicle.cylinders && cylinders && vehicle.cylinders !== cylinders) return false;
  if (vehicle.displacementLiters && displacement
      && Math.abs(vehicle.displacementLiters - displacement) > 0.15) return false;
  const expectedFuel = fuelType(vehicle.fuel);
  if (expectedFuel && fuels.some(fuel => fuel !== null) && !fuels.includes(expectedFuel)) return false;
  const powertrain = `${string(row.atvType) ?? ''} ${string(row.model) ?? ''}`;
  const expectedPowertrain = electrification(vehicle.electrification);
  const dualFuel = fuels.some(fuel => fuel !== null && fuel !== 'electric');
  const candidatePowertrain = electrification(string(row.atvType)) ?? electrification(powertrain)
    ?? (fuels.includes('electric') ? (dualFuel ? 'phev' : 'bev') : 'none');
  if (expectedPowertrain && expectedPowertrain !== candidatePowertrain) return false;
  return true;
}

function toConfiguration(row: Row, url: URL, id: string) {
  const model = string(row.model);
  if (String(row.id) !== id || !model) throw new Error('Fuel-economy configuration did not match the request.');
  const fuel = string(row.fuelType1);
  const electric = fuelType(fuel) === 'electric';
  const secondaryFuel = string(row.fuelType2);
  return {
    id, url: url.href, model, fuel, drive: driveType(string(row.drive)),
    transmission: string(row.trany), cylinders: number(row.cylinders),
    displacementLiters: number(row.displ), units: units(fuel),
    city: number(row.city08), highway: number(row.highway08), combined: number(row.comb08),
    secondary: secondaryFuel ? {
      fuel: secondaryFuel,
      units: units(secondaryFuel),
      city: number(row.cityA08), highway: number(row.highwayA08), combined: number(row.combA08),
    } : null,
    electricRangeMiles: electric ? number(row.range)
      : fuelType(secondaryFuel) === 'electric' ? number(row.rangeA) : null,
  };
}

export function lookupFuelEconomy(vehicle: Vehicle | null, get: GetJson) {
  const params: Record<string, string> = vehicle ? {year: String(vehicle.year), make: vehicle.make} : {};
  const url = vehicle ? endpoint(EPA, '/ws/rest/vehicle/menu/model', params) : DOCS;
  return section('EPA/DOE FuelEconomy.gov', url, 'configuration', vehicle && (async url => {
    if (vehicle.year < 1984) return [];
    const body = await get(url);
    const base = modelLabel(vehicle.model);
    const models = [...new Set(menuItems(body.menuItem).flatMap(row => {
      const name = string(row.value);
      if (!name) return [];
      const key = modelLabel(name);
      return key === base || key.startsWith(`${base} `) ? [name] : [];
    }))];
    if (models.length > 24) throw new Error('Too many catalog candidates for one lookup.');

    const lists = await inBatches(models, async model => {
      const result = await get(endpoint(EPA, '/ws/rest/vehicle/menu/options', {...params, model}));
      return menuItems(result.menuItem).flatMap(row => {
        const id = string(row.value);
        return id && /^\d+$/.test(id) ? [id] : [];
      });
    });
    const ids = [...new Set(lists.flat())];
    if (ids.length > 48) throw new Error('Too many fuel economy configurations for one lookup.');

    const rows = await inBatches(ids, async id => {
      const url = endpoint(EPA, `/ws/rest/vehicle/${id}`);
      return {id, url, row: await get(url)};
    });
    const candidates = rows.filter(({row}) => compatible(vehicle, row));
    const trim = vehicle.trim;
    const sameTrim = trim ? candidates.filter(({row}) => mentionsTrim(string(row.model) ?? '', trim)) : [];
    return (sameTrim.length ? sameTrim : candidates)
      .map(({id, url, row}) => toConfiguration(row, url, id));
  }));
}
