import {asRows, endpoint, number, string, type GetJson} from './upstream.js';

const VIN = /^[A-HJ-NPR-Z0-9]{17}$/;
const LETTERS: Readonly<Record<string, number>> = Object.freeze({
  A: 1, B: 2, C: 3, D: 4, E: 5, F: 6, G: 7, H: 8,
  J: 1, K: 2, L: 3, M: 4, N: 5, P: 7, R: 9,
  S: 2, T: 3, U: 4, V: 5, W: 6, X: 7, Y: 8, Z: 9,
});
const WEIGHTS = [8, 7, 6, 5, 4, 3, 2, 10, 0, 9, 8, 7, 6, 5, 4, 3, 2];

export function validateVin(value: string): {vin: string; northAmericanCheckDigitValid: boolean} {
  const vin = value.trim().toUpperCase();
  if (!VIN.test(vin)) throw new RangeError('Enter a 17-character VIN using letters other than I, O and Q.');
  const sum = [...vin].reduce((total, char, index) => total + (LETTERS[char] ?? Number(char)) * WEIGHTS[index], 0);
  const digit = sum % 11;
  return {vin, northAmericanCheckDigitValid: vin[8] === (digit === 10 ? 'X' : String(digit))};
}

export type Drive = 'fwd' | 'rwd' | '2wd' | 'awd' | '4wd' | 'awd_or_4wd';

export function driveType(value: string | null): Drive | null {
  if (!value) return null;
  const allWheel = /\bAWD\b|all[- ]wheel/i.test(value);
  const fourWheel = /\b4WD\b|\b4x4\b|(?:four|4)[- ]wheel/i.test(value);
  if (allWheel && fourWheel) return 'awd_or_4wd';
  if (allWheel) return 'awd';
  if (fourWheel) return '4wd';
  if (/\bFWD\b|front[- ]wheel/i.test(value)) return 'fwd';
  if (/\bRWD\b|rear[- ]wheel/i.test(value)) return 'rwd';
  if (/\b2WD\b|\b4x2\b|two[- ]wheel/i.test(value)) return '2wd';
  return null;
}

export function sameDrive(left: Drive | null, right: Drive | null): boolean {
  if (!left || !right || left === right) return true;
  if (left === 'awd_or_4wd') return right === 'awd' || right === '4wd';
  if (right === 'awd_or_4wd') return left === 'awd' || left === '4wd';
  return (left === '2wd' && (right === 'fwd' || right === 'rwd'))
    || (right === '2wd' && (left === 'fwd' || left === 'rwd'));
}

export function modelLabel(value: string): string {
  return value.toUpperCase().replace(/(?<=[A-Z0-9])-(?=\d)/g, '').replace(/[^A-Z0-9]+/g, ' ').trim();
}

export interface Identity {
  year: number | null;
  make: string | null;
  model: string | null;
  trim: string | null;
  bodyClass: string | null;
  doors: number | null;
  cabType: string | null;
  drive: Drive | null;
  cylinders: number | null;
  displacementLiters: number | null;
  fuel: string | null;
  electrification: string | null;
}

export type Vehicle = Identity & {year: number; make: string; model: string};

export interface IdentitySection {
  source: 'NHTSA vPIC';
  url: string;
  scope: 'vin_pattern';
  status: 'ok' | 'partial' | 'no_records' | 'unavailable';
  vehicle: Identity | null;
  errorCode: string | null;
}

export function hasIdentity(identity: Identity | null): identity is Vehicle {
  return Boolean(identity?.year && identity?.make && identity?.model);
}

export async function lookupIdentity(vin: string, get: GetJson): Promise<IdentitySection> {
  const url = endpoint('https://vpic.nhtsa.dot.gov', `/api/vehicles/DecodeVinValues/${vin}`, {format: 'json'});
  const base = {source: 'NHTSA vPIC', url: url.href, scope: 'vin_pattern'} as const;
  try {
    const row = asRows((await get(url)).Results)[0];
    if (!row) return {...base, status: 'no_records', vehicle: null, errorCode: null};
    const errorCode = string(row.ErrorCode);
    const vehicle = {
      year: number(row.ModelYear), make: string(row.Make), model: string(row.Model),
      trim: string(row.Trim), bodyClass: string(row.BodyClass), doors: number(row.Doors),
      cabType: string(row.CabType), drive: driveType(string(row.DriveType)), cylinders: number(row.EngineCylinders),
      displacementLiters: number(row.DisplacementL), fuel: string(row.FuelTypePrimary),
      electrification: string(row.ElectrificationLevel),
    };
    if (!vehicle.year && !vehicle.make && !vehicle.model) {
      return {...base, status: 'no_records', vehicle: null, errorCode};
    }
    return {...base, status: hasIdentity(vehicle) ? 'ok' : 'partial', vehicle, errorCode};
  } catch {
    return {...base, status: 'unavailable', vehicle: null, errorCode: null};
  }
}
