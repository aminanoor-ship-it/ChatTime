import axios from 'axios';

export const api = axios.create({ baseURL: '/api', withCredentials: true });

// Any 401 outside the session check means the session ended (logout elsewhere, suspension, revocation).
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.startsWith('/auth/')) {
      window.dispatchEvent(new CustomEvent('chattime:unauthorized'));
    }
    return Promise.reject(error);
  },
);

export function errorMessage(error, fallback = 'Something went wrong. Please try again.') {
  if (error?.response?.data?.message) return error.response.data.message;
  if (error?.message && error.ok === false) return error.message;
  if (error?.request && !error.response) return 'Cannot reach the ChatTime server. Is the backend running?';
  return fallback;
}

export async function uploadFile(url, file, fields = {}, onProgress) {
  const form = new FormData();
  for (const [key, value] of Object.entries(fields)) form.append(key, value);
  form.append('file', file);
  const response = await api.post(url, form, {
    onUploadProgress: (event) => onProgress?.(event.total ? Math.round((event.loaded / event.total) * 100) : 0),
  });
  return response.data;
}
