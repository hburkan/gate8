import type { AdminAuthError } from './errors';

/**
 * Client-friendly state shared between the login server action and the login
 * form. Kept out of the `'use server'` actions module because that module may
 * only export async functions.
 */
export type LoginState = { error: AdminAuthError | null };

export const initialLoginState: LoginState = { error: null };

export type ForgotPasswordState = { error: AdminAuthError | null; sent: boolean };

export const initialForgotPasswordState: ForgotPasswordState = { error: null, sent: false };

export type UpdatePasswordState = { error: string | null; done: boolean };

export const initialUpdatePasswordState: UpdatePasswordState = {
  error: null,
  done: false,
};
