# Marinade Snapshot API

## Installation

```bash
$ pnpm install
```

## Running the CLI
```bash
pnpm run cli -- filters --json-output filters.json
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
