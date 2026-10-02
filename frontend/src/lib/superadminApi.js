import { fetchApiData } from "@/lib/apiFetch";

export const fetchSuperadminData = (path) => fetchApiData("superadmin", path);
