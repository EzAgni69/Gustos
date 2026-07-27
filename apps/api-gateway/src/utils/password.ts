/**
 * Gusto API Gateway — Password Utilities
 *
 * Uses bcrypt for secure password hashing and verification.
 */

import bcrypt from "bcrypt";

const SALT_ROUNDS = 12;

/**
 * Hash a plaintext password using bcrypt.
 */
export async function hashPassword(plaintext: string): Promise<string> {
  return bcrypt.hash(plaintext, SALT_ROUNDS);
}

/**
 * Verify a plaintext password against a bcrypt hash.
 */
export async function verifyPassword(
  plaintext: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plaintext, hash);
}
