import {driveType, modelLabel, sameDrive, type Vehicle} from './identity.js';
import {asRows, endpoint, inBatches, number, section, string, type GetJson} from './upstream.js';

const NHTSA = 'https://api.nhtsa.gov';
const DOCS = new URL('https://www.nhtsa.gov/nhtsa-datasets-and-apis');

function byVehicle(path: string, vehicle: Vehicle): URL {
  return endpoint(NHTSA, path, {make: vehicle.make, model: vehicle.model, modelYear: String(vehicle.year)});
}

function date(value: unknown): string | null {
  const raw = string(value);
  if (!raw) return null;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(raw);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : null;
}

export function lookupRecalls(vehicle: Vehicle | null, get: GetJson) {
  const url = vehicle ? byVehicle('/recalls/recallsByVehicle', vehicle) : DOCS;
  return section('NHTSA recall campaigns', url, 'year_make_model', vehicle && (async url =>
    asRows((await get(url)).results).map(row => ({
      campaignId: string(row.NHTSACampaignNumber), component: string(row.Component),
      reportedOn: date(row.ReportReceivedDate), summary: string(row.Summary),
      consequence: string(row.Consequence), remedy: string(row.Remedy),
    }))
  ));
}

export function lookupComplaints(vehicle: Vehicle | null, get: GetJson) {
  const url = vehicle ? byVehicle('/complaints/complaintsByVehicle', vehicle) : DOCS;
  return section('NHTSA owner complaints', url, 'year_make_model', vehicle && (async url =>
    asRows((await get(url)).results).map(row => ({
      complaintId: number(row.odiNumber), filedOn: date(row.dateComplaintFiled),
      components: string(row.components), reportedSummary: string(row.summary),
    }))
  ));
}

function cabType(value: string | null): string | null {
  if (!value) return null;
  if (/regular cab|standard cab/i.test(value)) return 'regular';
  if (/super ?cab|extended cab/i.test(value)) return 'extended';
  if (/crew/i.test(value)) return 'crew';
  return null;
}

async function ratingCandidates(vehicle: Vehicle, url: URL, get: GetJson) {
  const results = asRows((await get(url)).Results);
  if (results.length) return results;
  const makeUrl = new URL(url);
  makeUrl.pathname = makeUrl.pathname.slice(0, makeUrl.pathname.lastIndexOf('/model/'));
  const base = modelLabel(vehicle.model);
  const cab = cabType(vehicle.cabType);
  const aliases = asRows((await get(makeUrl)).Results).flatMap(row => {
    const name = string(row.Model);
    if (!name || !modelLabel(name).startsWith(base + ' ')) return [];
    const candidateCab = cabType(name);
    if (cab && candidateCab && cab !== candidateCab) return [];
    if (/diesel/i.test(name) && /gasoline/i.test(vehicle.fuel ?? '')) return [];
    return [name];
  });
  const unique = [...new Set(aliases)];
  if (unique.length > 12) throw new Error('Too many NHTSA test variants for one lookup.');
  return (await inBatches(unique, async name => {
    return asRows((await get(endpoint(NHTSA, makeUrl.pathname + '/model/' + encodeURIComponent(name)))).Results);
  })).flat();
}

function stars(value: unknown): number | null {
  const rating = number(value);
  return rating !== null && Number.isInteger(rating) && rating <= 5 ? rating : null;
}

export function lookupRatings(vehicle: Vehicle | null, get: GetJson) {
  const url = vehicle ? endpoint(NHTSA,
    `/SafetyRatings/modelyear/${vehicle.year}/make/${encodeURIComponent(vehicle.make)}/model/${encodeURIComponent(vehicle.model)}`)
    : DOCS;
  return section('NHTSA 5-Star Safety Ratings', url, 'configuration', vehicle && (async url => {
    const candidates = await ratingCandidates(vehicle, url, get);
    const compatible = candidates.flatMap(row => {
      const id = number(row.VehicleId);
      const description = string(row.VehicleDescription);
      if (id === null || !description) return [];
      const drive = driveType(description);
      const doors = number(description.match(/\b(\d)\s*(?:DR|DOOR)\b/i)?.[1]);
      if (!sameDrive(vehicle.drive, drive) || (vehicle.doors && doors && vehicle.doors !== doors)) return [];
      return [{id, description, drive}];
    });
    const unique = [...new Map(compatible.map(item => [item.id, item])).values()];
    const ratings = await inBatches(unique, async ({id, description, drive}) => {
      const detail = endpoint(NHTSA, `/SafetyRatings/VehicleId/${id}`);
      const row = asRows((await get(detail)).Results)[0];
      if (!row || number(row.VehicleId) !== id) throw new Error('Safety rating variant did not match the request.');
      return {
        id, description, drive, url: detail.href,
        overall: stars(row.OverallRating), frontalCrash: stars(row.OverallFrontCrashRating),
        sideCrash: stars(row.OverallSideCrashRating), rollover: stars(row.RolloverRating),
      };
    });
    return ratings.filter(rating => [rating.overall, rating.frontalCrash, rating.sideCrash, rating.rollover]
      .some(value => value !== null));
  }));
}
