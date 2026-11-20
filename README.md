# Vehicle Profile

A TypeScript library and CLI from Standard Issue Data. Look up a vehicle's identity, recall campaigns, owner complaints, crash ratings, and rated fuel economy from a VIN. The tool calls public U.S. data sources directly.

## Install and use

Requires Node.js 22 or later.

The 0.1.0 release is being prepared locally. The registry commands below apply after publication.

```sh
npm install @standardissuedata/vehicle-profile
npx @standardissuedata/vehicle-profile 4T1K61AK7RU219133
```

For a global CLI installation:

```sh
npm install --global @standardissuedata/vehicle-profile
vehicle-profile 4T1K61AK7RU219133
```

To build from source:

```sh
npm ci
npm run build
node bin/vehicle-profile.mjs 4T1K61AK7RU219133
```

Once installed as a package, the command is `vehicle-profile <VIN>`.

```ts
import { lookupVehicle, validateVin } from '@standardissuedata/vehicle-profile';

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

Legacy EPA records that combine all-wheel and four-wheel drive use `drive: 'awd_or_4wd'`. They remain compatible with either drivetrain, but do not establish which one the vehicle has. Fuel-economy units are `mpge` for electricity and natural gas, and `mpg` for gasoline and other liquid fuels. Plug-in hybrids retain both fuel ratings and electric range.

The full VIN is sent to vPIC. The safety and fuel-economy queries use decoded details. For bulk workloads, use [NHTSA's published downloads](https://www.nhtsa.gov/nhtsa-datasets-and-apis) and the [fuel-economy files](https://www.fueleconomy.gov/feg/download.shtml). See the [NHTSA API use policy](https://api.nhtsa.gov/).

## Contribute

Run `npm ci`, `npm test`, and `npm run test:package`. CI runs these checks on Node.js 22, 24, and 26. The tests use offline fixtures; CI does not query upstream APIs or publish packages. The package check builds and installs a tarball offline, verifies the library and CLI, and compiles a TypeScript consumer.

When reporting a matching issue, include the model year, make, model, and relevant source record IDs. Share a VIN in a public issue only if you intend it to be public.

See [CHANGELOG.md](./CHANGELOG.md) for release notes.

The code is MIT-licensed. Upstream datasets and records remain subject to their respective source terms.
