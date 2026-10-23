import * as z from 'zod/v4';

const identity = z.string().regex(/^[A-Za-z0-9:_-]{1,120}$/);
const counter = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER);
export const contextSchema = z.object({
  serverEpoch: identity,
  activeModule: z.literal('develop'),
  selectedPhotoUuid: identity,
  contextCounter: counter,
  contextChangedAt: counter,
  developCounter: counter
}).strict();
const slider = z.string().min(1).max(120);
const requestId = z.string().regex(/^[A-Za-z0-9:_-]{1,100}$/)
  .describe('Unique ID for one deliberate action. Reuse the identical ID and arguments only to retrieve its result; never make a new ID to retry uncertainty.');
const context = contextSchema.describe('Copy the exact context from a fresh LRBridge read. Never invent or update these tokens yourself.');
const write = { requestId, context, slider };
export const schemas = {
  lrbridge_get_status: z.object({}).strict(),
  lrbridge_get_photo_context: z.object({}).strict(),
  lrbridge_list_sliders: z.object({ group: z.string().max(100).optional(), includeAvailability: z.boolean().default(true) }).strict(),
  lrbridge_get_slider_values: z.object({ sliders: z.array(slider).min(1).max(128).optional() }).strict(),
  lrbridge_set_slider: z.object({ ...write, value: z.number().finite() }).strict(),
  lrbridge_adjust_slider: z.object({ ...write, amount: z.number().finite().refine(v => v !== 0, 'Amount must be nonzero')
    .describe('Numeric displacement in slider units, e.g. Exposure 0.01 or Vibrance 5. Not Lightroom increment counts. The SDK nudge clamps at bounds.') }).strict(),
  lrbridge_reset_slider: z.object(write).strict(),
  lrbridge_set_multiple_sliders: z.object({ requestId, context,
    adjustments: z.array(z.object({ slider, value: z.number().finite() }).strict()).min(1).max(8)
  }).strict(),
  lrbridge_get_operation: z.object({ requestId }).strict()
};
