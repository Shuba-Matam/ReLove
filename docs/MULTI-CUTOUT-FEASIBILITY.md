# Multi-cutout feasibility (explored, not implemented)

Status: proposal only. The current single-cutout SAM flow, route, cache result, listing payload, and SQL contract remain unchanged.

## What is feasible

The installed parser can represent multiple distinct mask records, and the existing composer can be reused once per selected mask. That proves the client library can carry multiple masks; it does not prove that an automatic text request will reliably find three separate saleable items, nor that three outputs will cost one provider attempt.

Meta's SAM guidance describes text prompting around one concept per request. Different item types therefore need separate text requests, while multi-object prompting in one request requires explicit box or point prompts. The installed `@meta-sam/parser` `buildObjectPrompt` helper supports an `objects[]` shape with stable object IDs. Automatic discovery of roughly three unrelated items would still need a separate detector/vision step, or user-provided boxes/points first.

## Recommended MVP

Add a separate optional experiment/route for manual tap or box selection of up to three items from one immutable original upload. Keep the existing single-cutout flow as the default and unchanged.

For each selected region:

- assign a stable candidate ID independent of array order;
- retain source image identity, prompt/region, mask bounds, and preview ownership;
- compose and preview each mask separately, with a maximum of three candidates;
- require the seller to explicitly review and publish one listing per selected result;
- never publish, merge, or replace the original automatically.

Automatic item discovery should be a follow-up experiment after detector quality, latency, and cost are measured. Do not promise three usable returns from one text request.

## Contract choices

Two storage/operation designs are possible, and neither should be added without approval:

1. Separate per-item operations: reuse the current one-result database contract for every selected item. This is the safest MVP, but can cost up to three segmentation attempts plus any separate detection attempt.
2. One shared operation with candidate results: change route/cache validation to a candidate array. Listing validation and the SQL trigger must then prove that the selected `cutout_path` and URL belong to that operation's candidate array, to the authenticated owner, and to the same source image.

The active combined quota counts provider attempts: 15 per ordinary account and 30 for an approved owner. Three cutouts must not silently be presented as three outputs for one credit; measured provider behavior and metering determine the real count.

## Cleanup and ownership

Reusing one original requires reference-aware cleanup. Replacing or deleting one listing/candidate must not delete the shared upload while another draft, operation, or published listing still references it. Abandoned candidate previews need expiry/orphan cleanup, while published candidate files retain normal owner/source validation.

## Decision gate

Before implementation, approve the experiment route, per-item versus candidate-array operation model, any schema/trigger changes, cleanup retention, and measured provider-attempt budget. No remote settings, quotas, SQL, or production SAM behavior change as part of this feasibility work.
