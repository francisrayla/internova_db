import { apiFetch } from '@/lib/apiFetch';

export async function fetchSuperadminData(path) {
  const response = await apiFetch(`/api/superadmin/${path}`, {
    headers: {
      Accept: 'application/json',
    },
  });

  if (!response.ok) {
    const errorText = await response.text().catch(() => '');
    throw new Error(`Unable to load ${path} data: ${errorText || response.statusText}`);
  }

  return response.json();
}
