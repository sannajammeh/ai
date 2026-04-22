---
name: checkin-no-integration
description: Implement and talk to the Checkin.no API to create event participant syncs.
---

# Checkin.no API Integration Guide

Checkin.no is a Norwegian event ticketing/registration platform. Their API is GraphQL over HTTPS with Basic Auth. This document covers authentication, the queries in common use, response shapes, and data model concepts.

## Authentication

**Endpoint:** `https://api.checkin.no/graphql`

**Method:** HTTP Basic Auth. Encode `apiKey:apiSecret` as Base64.

```
POST https://api.checkin.no/graphql
Content-Type: application/json
Authorization: Basic <base64(apiKey + ":" + apiSecret)>
```

Three values needed from the Checkin.no dashboard:

| Value | Type | Description |
|-------|------|-------------|
| `apiKey` | string | API key |
| `apiSecret` | string | API secret |
| `customerId` | integer | Customer/organization ID |

All responses follow standard GraphQL envelope. Check `errors` first — may be present even on HTTP 200:

```json
{ "data": { ... }, "errors": [{ "message": "..." }] }
```

**GraphQL client note.** Any GraphQL client or plain `fetch` works. urql (`@urql/core`) with `fetchExchange` is a good zero-ceremony pick — pass `Authorization: Basic <token>` via `fetchOptions.headers`.

---

## Naming conventions (gotchas)

Checkin's schema mixes casing inconsistently. Always check before assuming.

| Surface | Convention | Example |
|---------|-----------|---------|
| GraphQL variable names | camelCase | `$customerId`, `$eventId` |
| Field arguments | snake_case | `customer_id:`, `id:` |
| Response fields (events list) | snake_case | `starts_at`, `url` |
| Response fields (single event) | camelCase + short | `start`, `url` |
| Ticket / order-user fields | camelCase | `isPaid`, `firstName`, `createdAt` |
| `eventTickets` event-id arg | `id:` (NOT `event_id:`) | `eventTickets(customer_id: $c, id: $e)` |

When in doubt, request a single field and inspect the error — Checkin's error messages list valid fields.

---

## Queries

### 1. List Events

Fetch active events for a customer ID.

```graphql
query FindEvents($customerId: Int!, $active: Boolean) {
  findEventsByCustomerID(customer_id: $customerId, active: $active) {
    id
    name
    starts_at
    url
  }
}
```

**Variables:** `{ "customerId": 12345, "active": true }`

| Field | Type | Notes |
|-------|------|-------|
| `id` | Int | Checkin event ID |
| `name` | String | Event display name |
| `starts_at` | String | ISO 8601 datetime (snake_case on THIS query) |
| `url` | String | Public event URL |

---

### 2. Event Structure + Availability (Categories, Additionals, Price, Spots Left)

Fetch an event's registration structure. Categories carry price and remaining spot count. Additionals describe extra field groups with selectable children.

```graphql
query EventStructure($eventId: Int!) {
  event(id: $eventId) {
    url
    start
    categories {
      id
      name
      price
      left
      additionals {
        id
        name
        children {
          id
          name
        }
      }
    }
  }
}
```

**Variables:** `{ "eventId": 220157 }`

| Field | Type | Notes |
|-------|------|-------|
| `event.start` | String | ISO 8601 datetime (camelCase/short on single event — NOT `starts_at`) |
| `event.url` | String | Public signup URL |
| `categories[].price` | String | Price as stringified number; add platform fees separately if needed |
| `categories[].left` | Int | Remaining spots in category |
| `categories[].additionals[]` | Array | Extra field groups (e.g. class, t-shirt size) |
| `additionals[].children[]` | Array | Selectable options |

**Hierarchy:** Event → Categories → Additionals → Children

| Level | Description |
|-------|-------------|
| **Category** | Ticket type / registration category |
| **Additional** | Extra field group attached to a category |
| **Children** | Selectable options inside an additional |

**Total capacity** = sum of `categories[].left` + count of registered participants (see query 3 or 4).

---

### 3. Event Tickets (simple participant list)

Fastest way to count or list registered participants. Returns one row per ticket with minimal shape.

```graphql
query EventTickets($customerId: Int!, $eventId: Int!) {
  eventTickets(customer_id: $customerId, id: $eventId) {
    id
    isPaid
    category { name }
    crm {
      firstName
      lastName
      email { email }
    }
    additionals {
      additional_parent_id
      id
      name
    }
  }
}
```

**Important:** the event-id argument is `id:` — not `event_id:`.

| Field | Type | Notes |
|-------|------|-------|
| `id` | Int | Ticket ID — stable across syncs, use as external identifier |
| `isPaid` | Boolean | Payment status |
| `category.name` | String | Category registered under |
| `crm.email.email` | String | Email double-nested: `crm.email` is an object, `email.email` is the string |
| `additionals[].additional_parent_id` | Int | References `additional.id` from structure query |
| `additionals[].id` | Int | Selected child option ID |
| `additionals[].name` | String | Display name of selected option |

Use this query when you only need a count or basic participant info.

---

### 4. All Event Order Users (filterable, paginated participants)

Richer participant query with server-side filtering, pagination, and ordering. Use when you need:

- Many participants (paginate via `length` + `offset`)
- Sort order (e.g. registration time ascending)
- Filters beyond a single event (status, category, dates)
- Flattened additional values as `{ name, value }` pairs

```graphql
query allEventOrderUsers(
  $customerId: Int,
  $length: Int,
  $offset: Int,
  $reportFilters: [EventOrderUserReportFilterInput!]
) {
  allEventOrderUsers(
    customerId: $customerId,
    length: $length,
    offset: $offset,
    reportFilters: $reportFilters
  ) {
    records
    data {
      createdAt
      crm { firstName lastName }
      ticket { id name type }
      additionals { name value }
    }
  }
}
```

**Variables example** — all order users for a single event, oldest first:

```json
{
  "customerId": 12345,
  "length": 500,
  "offset": 0,
  "reportFilters": [
    {
      "rule": "AND",
      "conditions": [
        { "rule": "AND", "field": "EVENT_ID", "operator": "EQUALS", "value": "220157" }
      ],
      "groups": [],
      "groupBy": [],
      "orderBy": [{ "field": "CREATED_AT", "direction": "ASC" }]
    }
  ]
}
```

**Filter shape.** `reportFilters` is an array of filter groups; each group has `rule` (AND/OR), `conditions[]`, `groups[]` (nested), `groupBy[]`, `orderBy[]`. Filter `value` is always a string, even for integer fields like `EVENT_ID`.

**Response notes:**

| Field | Type | Notes |
|-------|------|-------|
| `records` | Int | Total matching rows (use for pagination) |
| `data[].ticket.id` | Int | Category ID (what you'd match to `categories[].id`) |
| `data[].ticket.name` | String | Category display name |
| `data[].ticket.type` | String | Ticket type classification |
| `data[].additionals[]` | Array | Flat `{ name, value }` pairs — NOT the same shape as query 3 |
| `data[].additionals[].name` | String | Sometimes prefixed, e.g. `"Klasse - Men"` — split/strip as needed |
| `data[].additionals[].value` | String | Raw user input or option value |

The flat `{ name, value }` shape here differs from query 3's `{ additional_parent_id, id, name }`. Pick the query that matches the shape you want.

---

## Common display patterns

Generic recipes seen in real integrations. Adapt the constants to the event's own field names.

### Adding a platform/service fee to displayed price

Checkin's `category.price` is the base ticket price. Many integrations show a combined price that includes a fixed service fee charged at checkout. Keep the fee as a named constant so it's easy to update.

```ts
const SERVICE_FEE = 39; // Checkin platform fee — update per deployment

const displayPrice = Number(category.price) + SERVICE_FEE;
```

Apply once per category row. If you fan out a category into multiple rows (one per child option, see below), the fee still applies once per ticket.

### Flattening a "class"-style additional into price rows

A common UX: one price row per *option* of a designated additional (e.g. an additional named "Klasse" with children "Men" / "Women"), instead of one row per category. Generic shape:

```ts
const GROUP_ADDITIONAL_NAME = "Klasse"; // or whatever the organizer calls it

for (const cat of event.categories) {
  const price = Number(cat.price) + SERVICE_FEE;
  const group = cat.additionals.find(a => a.name === GROUP_ADDITIONAL_NAME);
  if (group && group.children.length > 0) {
    for (const child of group.children) {
      rows.push({ name: child.name, price });
    }
  } else {
    rows.push({ name: cat.name, price }); // fallback: category itself
  }
}
```

Match the additional by `id` instead of `name` when the label is unstable.

### Custom group ordering (e.g. class order)

Checkin returns categories/additionals in whatever order the organizer configured. For domain-specific display ordering (age groups, skill levels, t-shirt sizes), provide an explicit order array and sort against it. Append any unknown groups at the end so nothing disappears.

```ts
const groupOrder: string[] = ["Men Elite", "Women Elite", "Men 15-16", /* ... */];

const ordered: Record<string, T> = {};
for (const name of groupOrder) {
  if (groupMap.has(name)) {
    ordered[name] = groupMap.get(name)!;
    groupMap.delete(name);
  }
}
for (const [name, val] of groupMap) ordered[name] = val; // leftovers
```

Keep `groupOrder` in the consuming project (not the client) — it's domain config, not Checkin API.

### Pulling a single-value additional (e.g. club, team, bib #)

Free-text or single-select additionals come back as one `{ name, value }` entry on query 4. Read by name with a safe default:

```ts
const club = user.additionals.find(a => a.name === "Klubb")?.value ?? "";
```

### Total capacity

```ts
const registered = eventTickets.length; // or allEventOrderUsers.records
const totalSpots = event.categories.reduce((s, c) => s + c.left, 0) + registered;
```

---

## Participant Grouping

Participants can be grouped two ways, regardless of which query supplies them:

**By category** — use ticket category name.

- Query 3: `ticket.category.name`
- Query 4: `ticket.name`

**By additional field** — read the participant's additional that corresponds to a known group.

- Query 3: pick by `additional_parent_id` matching the parent's `id` from the structure query:

  ```ts
  const group = ticket.additionals
    .find(a => a.additional_parent_id === targetAdditionalId)
    ?.name;
  ```

- Query 4: match by `name` (no parent IDs available). If the source prefixes the group, strip it:

  ```ts
  const entry = user.additionals.find(a => a.name.startsWith("GroupName - "));
  const group = entry?.name.replace("GroupName - ", "") ?? entry?.value;
  ```

---

## Minimal client example (plain fetch)

Zero dependencies, works in any JS/TS runtime.

```ts
const ENDPOINT = "https://api.checkin.no/graphql";

async function checkinQuery<T>(
  apiKey: string,
  apiSecret: string,
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const token = btoa(`${apiKey}:${apiSecret}`);
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Basic ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(`Checkin HTTP ${res.status}: ${await res.text()}`);
  }

  const json = await res.json();
  if (json.errors?.length) {
    throw new Error(json.errors.map((e: any) => e.message).join(", "));
  }
  return json.data;
}
```

## urql client example

```ts
import { Client, fetchExchange } from "@urql/core";

const token = btoa(`${apiKey}:${apiSecret}`);

export const checkinClient = new Client({
  url: "https://api.checkin.no/graphql",
  exchanges: [fetchExchange],
  fetchOptions: { headers: { Authorization: `Basic ${token}` } },
});

const result = await checkinClient.query(EventStructureQuery, { eventId }).toPromise();
if (result.error) { /* handle */ }
```

---

## Gotchas

| Pitfall | Detail |
|---------|--------|
| `eventTickets` event arg | Use `id:` NOT `event_id:` |
| `event(id).start` vs `findEventsByCustomerID.starts_at` | Single event uses `start`; events list uses `starts_at` |
| `crm.email.email` | Email is double-nested: `crm` → `email` object → `email` string |
| `category.price` is a String | Parse with `Number()` before arithmetic |
| `additionals` shape varies | Query 3 returns `{ additional_parent_id, id, name }`; query 4 returns `{ name, value }` |
| Query 4 filter `value` | Always a string, even for numeric fields like `EVENT_ID` |
| Query 4 pagination | `length` caps page size; loop with `offset` until rows < length or total reached via `records` |
| Mixed casing | Variables camelCase, field args snake_case, response fields vary per query |
| `isPaid` camelCase | Unlike most other snake_case fields |
| Ticket `id` stable | Use as external identifier for idempotent sync |
| Caching | Participant data changes frequently; a short in-memory TTL (e.g. 5 min) is reasonable for public pages |
