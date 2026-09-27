import { prisma } from "@project/db";
import { z } from "zod";

export const preferenceFlagParamsSchema = z.object({
	flagId: z.string().min(1),
});

export class PreferenceNotFoundError extends Error {
	constructor() {
		super("Preference flag not found");
		this.name = "PreferenceNotFoundError";
	}
}

export async function listUserPreferences(userId: string) {
	return prisma.userPreference.findMany({
		where: { userId },
		include: { flag: true },
		orderBy: { flag: { code: "asc" } },
	});
}

export async function enableUserPreference(userId: string, flagId: string) {
	const flag = await prisma.preferenceFlag.findUnique({ where: { id: flagId } });
	if (!flag) throw new PreferenceNotFoundError();

	const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
	if (!user) throw new PreferenceNotFoundError();

	return prisma.userPreference.upsert({
		where: { userId_flagId: { userId, flagId } },
		create: { userId, flagId },
		update: {},
		include: { flag: true },
	});
}

export async function disableUserPreference(userId: string, flagId: string) {
	const flag = await prisma.preferenceFlag.findUnique({ where: { id: flagId } });
	if (!flag) throw new PreferenceNotFoundError();

	await prisma.userPreference.deleteMany({ where: { userId, flagId } });
}