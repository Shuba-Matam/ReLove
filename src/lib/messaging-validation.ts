import { z } from "zod";

export const messagingTimestampSchema = z.string().datetime({ offset: true });
