export class ApiError extends Error {
  status: number;
  details?: any;

  constructor(message: string, status: number, details?: any) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.details = details;
  }
}

export interface RequestOptions extends RequestInit {
  params?: Record<string, string | number | boolean | undefined | null>;
}

// Same-origin by default: Next.js proxies /api/v1/* to the API (see next.config.ts), so the
// httpOnly session cookie travels automatically. NEXT_PUBLIC_API_URL is only for talking to an
// API on another origin, which then needs a matching CORS_ORIGINS entry.
const getBaseUrl = (): string => {
  if (typeof process !== 'undefined' && process.env?.NEXT_PUBLIC_API_URL) {
    return process.env.NEXT_PUBLIC_API_URL.replace(/\/+$/, '');
  }
  return '';
};

export async function apiClient<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const baseUrl = getBaseUrl();
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;

  let urlString = `${baseUrl}${normalizedPath}`;
  if (options.params) {
    const searchParams = new URLSearchParams();
    Object.entries(options.params).forEach(([key, value]) => {
      if (value !== undefined && value !== null) {
        searchParams.append(key, String(value));
      }
    });
    const queryString = searchParams.toString();
    if (queryString) {
      urlString += (urlString.includes('?') ? '&' : '?') + queryString;
    }
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    ...(options.headers as Record<string, string>),
  };

  const fetchOptions: RequestInit = {
    credentials: 'include',
    ...options,
    headers,
  };

  const response = await fetch(urlString, fetchOptions);

  if (!response.ok) {
    let errorMessage = `HTTP error ${response.status}: ${response.statusText}`;
    let errorDetails: any = null;

    try {
      const errorJson = await response.json();
      if (errorJson) {
        errorMessage = errorJson.error || errorJson.message || errorMessage;
        errorDetails = errorJson.details || errorJson;
      }
    } catch {
      try {
        const text = await response.text();
        if (text) errorMessage = text;
      } catch {
        // use default error message
      }
    }

    throw new ApiError(errorMessage, response.status, errorDetails);
  }

  // Handle empty 204 No Content
  if (response.status === 204) {
    return {} as T;
  }

  const contentType = response.headers.get('content-type');
  if (contentType && contentType.includes('application/json')) {
    return response.json() as Promise<T>;
  }

  return response.text() as unknown as Promise<T>;
}

export const api = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> => {
    return apiClient<T>(path, { ...options, method: 'GET' });
  },

  post: <T>(path: string, body?: any, options?: RequestOptions): Promise<T> => {
    return apiClient<T>(path, {
      ...options,
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  put: <T>(path: string, body?: any, options?: RequestOptions): Promise<T> => {
    return apiClient<T>(path, {
      ...options,
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  patch: <T>(path: string, body?: any, options?: RequestOptions): Promise<T> => {
    return apiClient<T>(path, {
      ...options,
      method: 'PATCH',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
  },

  delete: <T>(path: string, options?: RequestOptions): Promise<T> => {
    return apiClient<T>(path, { ...options, method: 'DELETE' });
  },
};

export default api;
