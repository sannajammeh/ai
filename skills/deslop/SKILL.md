---
name: deslop
description: >
  Strip slop from agent-written code: layers, comments and ceremony that add reading cost
  without adding behaviour. Use after writing or editing code, when reviewing a diff or PR,
  or when the user says "deslop".
---

Slop is code an agent adds that a reader must open, read and discard to learn nothing new. Every rule below names one kind. Apply every rule to every hunk in scope; the pass is done when each hunk is checked against each rule and every hit is fixed or reported.

A rule outranks a generic smell heuristic. When a DRY or "Duplicated Code" finding points at a rule's slop fix, the rule wins.

## Rules

### Call the abstraction directly

When a helper, error factory or client method already exists to remove repetition, call it at every site, even when the calls repeat arguments. Repeated calls to an existing abstraction are its intended use, never duplication.

Slop, a wrapper whose only job is forwarding to the abstraction:

```ts
const invalidGrant = (error_description: string) =>
	errors.INVALID_GRANT({
		data: { error: "invalid_grant", error_description },
	});

throw invalidGrant("client_id mismatch");
```

Clean:

```ts
throw errors.INVALID_GRANT({
	data: { error: "invalid_grant", error_description: "client_id mismatch" },
});
```

The same wrapper hides as a local closure, a one-line exported function, or a re-export under a new name. Fix: inline it at every call site, then delete it.
