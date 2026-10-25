export async function retryProfileRequest<T>(request: () => Promise<T>): Promise<T> {
  try {
    return await request()
  }
  catch (error) {
    const statusCode = (error as { statusCode?: number } | null)?.statusCode
    const retriable = typeof statusCode !== 'number' || statusCode === 408 || statusCode === 429 || statusCode >= 500
    if (!retriable)
      throw error
    await new Promise(resolve => setTimeout(resolve, 150))
    return request()
  }
}

export async function recoverProfileRequest<T>(
  request: Promise<T>,
  onRejected: () => void,
): Promise<T> {
  try {
    return await request
  }
  catch (error) {
    onRejected()
    throw error
  }
}

export function createProfileLoadGuard() {
  let latest = 0
  return {
    begin() {
      return ++latest
    },
    isCurrent(request: number | undefined) {
      return request === latest
    },
  }
}
