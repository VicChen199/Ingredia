import { currentUserId } from "@project/auth";
import {
  PreferenceNotFoundError,
  disableUserPreference,
  enableUserPreference,
  preferenceFlagParamsSchema,
} from "@project/domain";

export const dynamic = "force-dynamic";

function notFoundResponse() {
  return Response.json(
    { error: { code: "NOT_FOUND", message: "Preference flag not found" } },
    { status: 404 },
  );
}

function parseFlagId(params: { flagId: string }) {
  return preferenceFlagParamsSchema.safeParse(params);
}

export async function PUT(
  _request: Request,
  { params }: { params: Promise<{ flagId: string }> },
) {
  const parsed = parseFlagId(await params);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid preference flag id" } },
      { status: 400 },
    );
  }

  try {
    const preference = await enableUserPreference(await currentUserId(), parsed.data.flagId);
    return Response.json(preference.flag);
  } catch (error) {
    if (error instanceof PreferenceNotFoundError) return notFoundResponse();
    throw error;
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ flagId: string }> },
) {
  const parsed = parseFlagId(await params);
  if (!parsed.success) {
    return Response.json(
      { error: { code: "VALIDATION_ERROR", message: "Invalid preference flag id" } },
      { status: 400 },
    );
  }

  try {
    await disableUserPreference(await currentUserId(), parsed.data.flagId);
    return new Response(null, { status: 204 });
  } catch (error) {
    if (error instanceof PreferenceNotFoundError) return notFoundResponse();
    throw error;
  }
}