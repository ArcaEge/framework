import { redirect, error } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { db } from '$lib/server/db/index.js';
import { user } from '$lib/server/db/schema.js';
import { eq } from 'drizzle-orm';
import {
	SESSION_EXPIRY_DAYS,
	DAY_IN_MS,
	createSession,
	setSessionTokenCookie,
	generateSessionToken
} from '$lib/server/auth.js';

export async function GET(event) {
	const url = event.url;
	const cookies = event.cookies;

	const urlState = url.searchParams.get('state');
	const code = url.searchParams.get('code');

	if (!urlState || !code) {
		return error(418);
	}

	const cookieState = cookies.get('oauth_state');

	if (!cookieState || cookieState !== urlState) {
		const redirectURL = new URL(`${url.protocol}//${url.host}/auth/slack`);
		return redirect(302, redirectURL);
	}

	cookies.delete('oauth_state', { path: '/' });

	// Get token
	const openidConnectTokenURL = new URL('https://slack.com/api/openid.connect.token');
	openidConnectTokenURL.searchParams.set('code', code);
	openidConnectTokenURL.searchParams.set(
		'client_id',
		env.SLACK_CLIENT_ID ? env.SLACK_CLIENT_ID : ''
	);
	openidConnectTokenURL.searchParams.set(
		'client_secret',
		env.SLACK_CLIENT_SECRET ? env.SLACK_CLIENT_SECRET : ''
	);
	openidConnectTokenURL.searchParams.set('redirect_uri', `https://${url.host}/auth/callback`);

	const openidConnectTokenRes = await fetch(openidConnectTokenURL, {
		method: 'POST'
	});

	if (!openidConnectTokenRes.ok) {
		const redirectURL = new URL(`${url.protocol}//${url.host}/auth/slack`);
		return redirect(302, redirectURL);
	}

	const openidConnectTokenJSON = await openidConnectTokenRes.json();

	if (openidConnectTokenJSON['ok'] !== true) {
		const redirectURL = new URL(`${url.protocol}//${url.host}/auth/slack`);
		return redirect(302, redirectURL);
	}

	const token = openidConnectTokenJSON['access_token'];

	// Get user data
	const openidConnectDataURL = new URL('https://slack.com/api/openid.connect.userInfo');
	const openidConnectDataRes = await fetch(openidConnectDataURL, {
		method: 'POST',
		headers: {
			Authorization: `Bearer ${token}`
		}
	});

	if (!openidConnectDataRes.ok) {
		const redirectURL = new URL(`${url.protocol}//${url.host}/auth/slack`);
		return redirect(302, redirectURL);
	}

	const openidConnectDataJSON = await openidConnectDataRes.json();

	if (openidConnectDataJSON['ok'] !== true) {
		const redirectURL = new URL(`${url.protocol}//${url.host}/auth/slack`);
		return redirect(302, redirectURL);
	}

	const slackId = openidConnectDataJSON['https://slack.com/user_id'];
	const profilePic = openidConnectDataJSON['picture'];
	const name = openidConnectDataJSON['name']; // TODO: make this get the user's slack handle

	// TODO: Check Hackatime API if they're banned and identity if they're verified
	// https://identity.hackclub.com/api/external/check?slack_id=

	// Check Hackatime trust
	const hackatimeTrust = (
		await (
			await fetch(`https://hackatime.hackclub.com/api/v1/users/${slackId}/trust_factor`)
		).json()
	)['trust_level'];

	if (!hackatimeTrust) {
		return error(418, { message: 'failed to fetch hackatime trust factor, please try again later' });
	} else if (hackatimeTrust === 'red') {
		// Prevent login
		return redirect(302, "https://fraud.land");
	}

	// Create user if doesn't exist
	let databaseUser = await db.select().from(user).where(eq(user.slackId, slackId)).get();

	if (databaseUser) {
		// Update user (update name and profile picture and lastLoginAt on login)
		await db
			.update(user)
			.set({ name: name, profilePicture: profilePic, lastLoginAt: new Date(Date.now()), hackatimeTrust })
			.where(eq(user.slackId, slackId));
	} else {
		// Create user
		await db.insert(user).values({
			slackId: slackId,
			name: name,
			profilePicture: profilePic,
			createdAt: new Date(Date.now()),
			lastLoginAt: new Date(Date.now()),
			hackatimeTrust,
			// TODO: remove these after siege
			hasT1Review: true,
			hasT2Review: true,
			hasProjectAuditLogs: true,
			hasSessionAuditLogs: true
		});

		databaseUser = await db.select().from(user).where(eq(user.slackId, slackId)).get();

		if (!databaseUser) {
			// Something went _really_ wrong
			return error(500);
		}
	}

	const sessionToken = generateSessionToken();
	await createSession(sessionToken, databaseUser.id);
	setSessionTokenCookie(
		event,
		sessionToken,
		new Date(Date.now() + DAY_IN_MS * SESSION_EXPIRY_DAYS)
	);

	const redirectURL = new URL(`${url.protocol}//${url.host}/dashboard`);
	return redirect(302, redirectURL);
}
