# steve-duin-dot-com

Monorepo with a GraphQL API and React web app.

## Requirements
- Node 18+
- Yarn Classic (1.x)
- Postgres

## Setup
1. Install dependencies:
   - `yarn`
2. Copy env templates:
  - `cp api/.env.example api/.env`
   - Update `DATABASE_URL`
3. Run dev servers:
   - `yarn dev`

## Scripts
- `yarn dev` - run API and web in dev mode
- `yarn dev:api` - API only
- `yarn dev:web` - web only
- `yarn build` - build both packages
- `yarn typecheck` - typecheck all workspaces

## API
GraphQL endpoint: `http://localhost:4000/graphql`

Example query:
```
query SearchArticles($query: String!) {
  searchArticles(query: $query) {
    id
    title
    date
    source {
      id
      name
    }
  }
}
```
