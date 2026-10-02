import { fetchApiData } from "@/lib/apiFetch";

export const fetchSupervisorData = (path) => fetchApiData("supervisor", path);
