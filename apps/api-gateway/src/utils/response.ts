/**
 * Gusto API Gateway — Response Utilities
 *
 * Standardized API response builders for consistent JSON output.
 */

/**
 * Build a successful API response.
 */
export function success<T>(data: T, message?: string) {
  return {
    success: true as const,
    data,
    ...(message && { message }),
  };
}

/**
 * Build a paginated API response.
 */
export function paginated<T>(
  data: T[],
  total: number,
  page: number,
  limit: number,
  message?: string
) {
  return {
    success: true as const,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    ...(message && { message }),
  };
}

/**
 * Build an error API response.
 */
export function error(message: string) {
  return {
    success: false as const,
    message,
  };
}
