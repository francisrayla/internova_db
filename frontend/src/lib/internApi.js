import { fetchApiData } from "@/lib/apiFetch";

export const fetchInternData = (path) => fetchApiData("intern", path);
