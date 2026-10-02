import { fetchApiData } from "@/lib/apiFetch";

export const fetchCoordinatorData = (path) => fetchApiData("coordinator", path);
