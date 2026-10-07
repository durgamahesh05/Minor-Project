export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export class HttpClient {
  constructor(
    private readonly baseUrl: string,
    private readonly transport: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  upload<T>(path: string, body: FormData, onProgress: (percent: number) => void): Promise<T> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open("POST", `${this.baseUrl}${path}`);
      xhr.withCredentials = true;
      xhr.upload.onprogress = event => {
        if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100));
      };
      xhr.upload.onload = () => onProgress(100);
      xhr.onerror = () => reject(new ApiError(0, "Upload connection failed. Please try again."));
      xhr.onabort = () => reject(new ApiError(0, "Upload cancelled."));
      xhr.onload = () => {
        let result;
        try { result = JSON.parse(xhr.responseText); }
        catch { reject(new ApiError(xhr.status, "The server returned an invalid upload response.")); return; }
        if (xhr.status >= 200 && xhr.status < 300) resolve(result as T);
        else reject(new ApiError(xhr.status, result?.detail ?? result?.message ?? "Upload failed."));
      };
      xhr.send(body);
    });
  }

  async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const isFormData = options.body instanceof FormData;
    let res: Response;
    try {
      res = await this.transport(`${this.baseUrl}${path}`, {
        credentials: "include",
        ...options,
        headers: { ...(!isFormData && options.body ? { "Content-Type": "application/json" } : {}), ...(options.headers ?? {}) },
      });
    } catch {
      throw new ApiError(0, `Cannot connect to the API at ${this.baseUrl}. Make sure the backend is running.`);
    }

    // FastAPI returns an empty body for successful DELETE requests.
    if (res.status === 204) return undefined as T;
    const isJson = res.headers.get("content-type")?.includes("application/json");
    const body = isJson ? await res.json() : undefined;

    if (!res.ok) {
      throw new ApiError(res.status, body?.message ?? body?.detail ?? res.statusText);
    }
    return body as T;
  }
}
