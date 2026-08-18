"use client";

import { useEffect, useMemo, useState } from "react";
import { fetchSuperadminData } from "@/lib/superadminApi";

export default function UsersPage() {
  const [users, setUsers] = useState([]);
  const [query, setQuery] = useState("");
  const [roleFilter, setRoleFilter] = useState("All");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function loadUsers() {
      try {
        const response = await fetchSuperadminData("users");
        const nextUsers = Array.isArray(response?.users) ? response.users : [];
        setUsers(nextUsers);
      } catch (error) {
        console.error(error);
        setUsers([]);
      } finally {
        setLoading(false);
      }
    }

    loadUsers();
  }, []);

  const filteredUsers = useMemo(() => {
    return users.filter((user) => {
      const matchesRole = roleFilter === "All" || user.role === roleFilter;
      const matchesQuery = `${user.name} ${user.role} ${user.team}`.toLowerCase().includes(query.toLowerCase());
      return matchesRole && matchesQuery;
    });
  }, [query, roleFilter, users]);

  return (
    <div className="space-y-6">
      <section className="rounded-3xl border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center gap-3">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search users"
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none focus:border-blue-500"
          />
          <select
            value={roleFilter}
            onChange={(event) => setRoleFilter(event.target.value)}
            className="rounded-xl border border-slate-300 px-3 py-2 text-sm outline-none"
          >
            <option>All</option>
            <option>Superadmin</option>
            <option>Admin</option>
            <option>Coordinator</option>
            <option>Supervisor</option>
            <option>Intern</option>
          </select>
          <button className="ml-auto rounded-xl bg-blue-600 px-4 py-2 text-sm font-semibold text-white">Add user</button>
        </div>
      </section>

      <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] border-b border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-600">
          <span>Name</span>
          <span>Role</span>
          <span>Status</span>
          <span>Team</span>
        </div>
        {loading ? <p className="px-4 py-6 text-sm text-slate-600">Loading users…</p> : null}
        {!loading && filteredUsers.map((user) => (
          <div key={user.id} className="grid grid-cols-[1.2fr_0.8fr_0.8fr_0.8fr] border-b border-slate-100 px-4 py-4 text-sm text-slate-700 last:border-b-0">
            <span className="font-medium text-slate-900">{user.name}</span>
            <span>{user.role}</span>
            <span>{user.status}</span>
            <span>{user.team}</span>
          </div>
        ))}
        {!loading && !filteredUsers.length ? <p className="px-4 py-6 text-sm text-slate-600">No users matched your search.</p> : null}
      </section>
    </div>
  );
}
