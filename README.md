# Marinade Snapshot API

## Installation

```bash
$ pnpm install
```

## Running the CLI
```bash
export POSTGRES_URL=...
export RPC_URL=...
# preparing filters that are used while parsing snapshot by marinade-snapshot-etl
pnpm run cli -- filters --json-output filters.json
# parsing the pre-processed sqllite DB file produced by marinade-snapshot-etl
# this does not insert anything to PSQL until `--slot` argument is used
pnpm run cli -- parse --sqlite <input-sqlite> --csv-output <output-csv>
pnpm run cli -- record-msol-votes
```

## Running the app

```bash
# development
$ pnpm run start

# watch mode
$ pnpm run start:dev

# production mode
$ pnpm run start:prod
```

## Test

```bash
# unit tests
$ pnpm run test

# e2e tests
$ pnpm run test:e2e

# test coverage
$ pnpm run test:cov
```
