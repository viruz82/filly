# Filly

*Your filament friend.* Track 3D printer filament inventory, print history and material costs. Connects directly to Bambu Lab printers via **Bambu Lab Cloud (MQTT)**, no third-party Home Assistant integration required.

Filly is a personal fork of [cgradl/filament-manager](https://github.com/cgradl/filament-manager) (MIT). Full documentation with screenshots: [github.com/viruz82/filly](https://github.com/viruz82/filly).

## Prerequisites

- Home Assistant with Supervisor
- A Bambu Lab account (email + password)

## First-time setup

1. Open Filly and go to **Settings → Cloud Config**.
2. Under **Bambu Lab Cloud**, enter your account email and password and click **Connect** (complete 2FA if prompted).
3. Go to **Settings → Printers → Add Printer**, select your device and save. Optionally pick an energy sensor, a price sensor and a wear rate (€ per print hour).
4. Add your filament spools under **Spools**.

Do not run the original add-on and Filly at the same time: both write `sensor.filament_manager_*`.

## Pages

- **Dashboard**: key figures, charts, recent prints, low-stock alerts, questions such as "Which spool is in AMS 1 · T1?"
- **Spools**: tiles or list, search, filters, sort, detail with colours as hex and RGB, weighing, moisture, labels, **Share**
- **Printers**: live print card (progress, layer, remaining time, stage in plain words) and one card per AMS slot
- **Print jobs**: history with filament, cost and energy per print
- **Projects**: group prints with totals, cost overview as PDF
- **Maintenance**: tasks due by print hours, days or grams
- **Settings**: Cloud config, printers, catalog, moisture factors, export / import

## Features

- **Automatic print tracking** via Bambu Cloud MQTT, with per-tray filament use from the cloud task API
- **AMS slot assignment**: a slot with exactly one fitting spool is assigned silently (with Undo); otherwise Filly asks with ranked candidates
- **Colour modes**: single, gradient, multi-colour and special (glitter, glow, colour change, marble)
- **Manufacturer colours**: about 2,000 bundled colours, one tap fills brand, material, colour and effect
- **Costs**: material, energy (kWh sensor), printer wear per hour; project and inventory PDFs
- **Moisture estimate** with dryer workflow, **QR labels** (Niimbot D110 over Web Bluetooth, PNG, PDF), **maintenance log**
- **Share collection** (optional): public read-only links via a Cloudflare Worker you deploy yourself, see below
- **Export / import**: JSON backup, spool CSV, Bambu Cloud history, Spoolman export

## Share collection (optional)

Filly can publish a read-only page of your spools under an unguessable link. Home Assistant stays unreachable from the internet; Filly only sends a cleaned copy (spool number, brand, material, colour, remaining percent and optionally grams, never prices, locations or notes) to a small Cloudflare Worker in your own free Cloudflare account.

Set it up in this add-on's **Configuration**:

| Option | Meaning |
|---|---|
| `share_url` | Address of your Worker, `https://…workers.dev` (no path) |
| `share_key` | The key you set as `PUSH_KEY` in the Worker (at least 32 characters) |

Then open **Spools → Share**. Step-by-step guide: [docs/SHARE.md](https://github.com/viruz82/filly/blob/master/docs/SHARE.md).

## Home Assistant sensors

Pushed automatically through the HA States API, no configuration needed:

| Entity | Description |
|---|---|
| `sensor.filament_manager_pending_usages` | Prints awaiting filament usage confirmation |
| `sensor.filament_manager_low_stock_spools` | Spools below the low-stock threshold |
| `sensor.filament_manager_ams_unmatched` | AMS trays with no matching spool |
| `sensor.filament_manager_ams_spools` | AMS slots with an assigned spool (attribute `slots`: printer, slot, name, brand, material, colour, grams, percent) |
| `sensor.filament_manager_moisture_spools` | Spools below the dryness warning threshold |
| `sensor.filament_manager_maintenance_due` | Maintenance tasks that are due |
| `sensor.filament_manager_last_print` | Last print; attributes include `material_cost`, `energy_cost`, `wear_cost` |
| `sensor.filament_manager_total_spools`, `_consumed_spools` | Spool counts |
| `sensor.filament_manager_printer_<name>_status` | Live status per printer |
| `sensor.filament_manager_statistics` | Snapshot for dashboards (trends, stock, top lists, forecast) |
| `sensor.filament_manager_filament_used`, `_prints`, `_print_hours`, `_cost_total`, `_cost_material`, `_cost_energy`, `_cost_wear`, `_stock_weight`, `_stock_value` | Long-term statistics (usable in statistics graphs) |

## Data

All data is stored in `/data/filament.db`. App updates never modify this file, your inventory and print history are safe across upgrades. The share key is kept in the add-on options and is not part of the database or the JSON export.

## Support

Report issues at [github.com/viruz82/filly/issues](https://github.com/viruz82/filly/issues). Problems that also exist in the original: [github.com/cgradl/filament-manager](https://github.com/cgradl/filament-manager/issues).
