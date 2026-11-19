# Vehicle Profile

A TypeScript library and CLI from Standard Issue Data. Look up a vehicle's identity, recall campaigns, owner complaints, crash ratings, and rated fuel economy from a VIN. The tool calls public U.S. data sources directly.

## Run locally

Requires Node.js 22 or later.

```sh
npm ci
npm run build
node bin/vehicle-profile.mjs 4T1K61AK7RU219133
```

Once installed as a package, the command is `vehicle-profile <VIN>`.

```ts
import { lookupVehicle, validateVin } from 'sid-vehicle-profile';

const { vin } = validateVin('4T1K61AK7RU219133');
const profile = await lookupVehicle(vin);
console.log(profile.fuelEconomy.status, profile.fuelEconomy.records);
```

The CLI writes versioned JSON to standard output. Invalid input exits with status 2. A lookup without any decoded vehicle identity still emits JSON and exits with status 1. Check the status of each section when consuming partial results.

## Data and matching

| Section | Source | Scope |
|---|---|---|
| Identity | [NHTSA vPIC](https://vpic.nhtsa.dot.gov/api/) | VIN pattern |
| Recall campaigns | [NHTSA](https://www.nhtsa.gov/nhtsa-datasets-and-apis#recalls) | Model year, make, and model |
| Owner complaints | [NHTSA](https://www.nhtsa.gov/nhtsa-datasets-and-apis#complaints) | Model year, make, and model |
| Safety ratings | [NHTSA](https://www.nhtsa.gov/nhtsa-datasets-and-apis#ratings) | Test configuration |
| Fuel economy | [FuelEconomy.gov](https://www.fueleconomy.gov/feg/ws/) | EPA configuration |

A recall campaign found by model year, make, and model requires a separate [VIN-specific recall check](https://www.nhtsa.gov/recalls) to establish whether that vehicle still needs repair. Owner complaints are consumer reports about the model. Configuration results identify the compatible upstream records. When multiple candidates remain, the status is `ambiguous` and the response includes those candidates. Source errors and empty results have separate statuses.

The full VIN is sent to vPIC. The safety and fuel-economy queries use decoded details. For bulk workloads, use [NHTSA's published downloads](https://www.nhtsa.gov/nhtsa-datasets-and-apis) and the [fuel-economy files](https://www.fueleconomy.gov/feg/download.shtml). See the [NHTSA API use policy](https://api.nhtsa.gov/).

## Contribute

Run `npm test`. When reporting a matching issue, include the model year, make, model, and relevant source record IDs. Share a VIN in a public issue only if you intend it to be public. The tests use offline fixtures.

The code is MIT-licensed. Upstream datasets and records remain subject to their respective source terms.
