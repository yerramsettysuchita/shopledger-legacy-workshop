# Repository Guidelines

## Stack

ShopLedger runs on Node.js with CommonJS, Express 4, and body-parser 1. The browser UI uses plain HTML, CSS, and JavaScript. The app persists data in `data/db.json`.

## Module Map

- `server.js` serves `public/`, mounts the `/api` routes, and handles `GET /orders/:id/invoice`.
- `routes/` contains the product, order, customer, and report API handlers.
- `lib/` handles orders, pricing, GST, coupons, inventory, Khata, dates, reporting, invoice rendering, and JSON storage.
- `config.js` holds port, shop, GST, inventory, and coupon settings.

## Commands

- `npm install` installs the declared dependencies.
- `npm start` runs `node server.js` on port `3000` by default. Set `PORT` to override it.
- `npm test` runs a placeholder that exits with status `1`.

## Contributor Rules

- Write characterization tests that capture existing behaviour before changing it.
- Change only the application module the ticket is about.
- Tests must never read or write `data/db.json`. Use independent fixtures or in-memory data.
- Add no dependencies.
