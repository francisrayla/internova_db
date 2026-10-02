"use client";

import { useEffect, useMemo, useState } from "react";

const selectClass = "w-full rounded-xl border px-4 py-2.5 text-sm outline-none focus:ring-1";
const normalBorder = "border-slate-300 focus:border-blue-500 focus:ring-blue-200";
const errorBorder = "border-red-400 focus:border-red-500 focus:ring-red-100";

function composeAddress({ detail, cityName, provinceName }) {
  const parts = [detail?.trim(), cityName, provinceName].filter(Boolean);
  return parts.join(", ");
}

/**
 * Region → Province → City/Municipality cascading picker, PSGC-sourced
 * (public/data/ph-address/*.json), plus a free-text field for barangay and
 * street/building — going further than city level (down to barangay) would
 * mean shipping ~42,000 more rows for a form filled out once per school.
 * The region itself is composed into the address string; a written Philippine
 * mailing address conventionally names the city and province, not the
 * region, so it's dropped from the final value passed up via onChange.
 */
export default function AddressPicker({ onChange, invalid }) {
  const [regions, setRegions] = useState([]);
  const [provinces, setProvinces] = useState([]);
  const [cities, setCities] = useState([]);
  const [loadError, setLoadError] = useState("");

  const [regionCode, setRegionCode] = useState("");
  const [provinceCode, setProvinceCode] = useState("");
  const [cityCode, setCityCode] = useState("");
  const [detail, setDetail] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/data/ph-address/region.json").then((r) => r.json()),
      fetch("/data/ph-address/province.json").then((r) => r.json()),
      fetch("/data/ph-address/city.json").then((r) => r.json()),
    ])
      .then(([r, p, c]) => {
        setRegions(r);
        setProvinces(p);
        setCities(c);
      })
      .catch(() => setLoadError("Could not load the address list. You can still type your address below."));
  }, []);

  const provinceOptions = useMemo(
    () => provinces.filter((p) => p.region_code === regionCode).sort((a, b) => a.province_name.localeCompare(b.province_name)),
    [provinces, regionCode]
  );
  const cityOptions = useMemo(
    () => cities.filter((c) => c.province_code === provinceCode).sort((a, b) => a.city_name.localeCompare(b.city_name)),
    [cities, provinceCode]
  );

  function emit(next) {
    const province = provinces.find((p) => p.province_code === next.provinceCode);
    const city = cities.find((c) => c.city_code === next.cityCode);
    onChange(composeAddress({ detail: next.detail, cityName: city?.city_name, provinceName: province?.province_name }));
  }

  function handleRegion(value) {
    setRegionCode(value);
    setProvinceCode("");
    setCityCode("");
    emit({ provinceCode: "", cityCode: "", detail });
  }
  function handleProvince(value) {
    setProvinceCode(value);
    setCityCode("");
    emit({ provinceCode: value, cityCode: "", detail });
  }
  function handleCity(value) {
    setCityCode(value);
    emit({ provinceCode, cityCode: value, detail });
  }
  function handleDetail(value) {
    setDetail(value);
    emit({ provinceCode, cityCode, detail: value });
  }

  if (loadError) {
    return (
      <div>
        <p className="mb-1.5 text-xs text-amber-600">{loadError}</p>
        <input
          onChange={(e) => onChange(e.target.value)}
          maxLength={255}
          placeholder="City, Province"
          className={`${selectClass} ${invalid ? errorBorder : normalBorder}`}
        />
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <select value={regionCode} onChange={(e) => handleRegion(e.target.value)} className={`${selectClass} appearance-none ${invalid && !regionCode ? errorBorder : normalBorder}`}>
          <option value="">Region…</option>
          {regions.map((r) => <option key={r.region_code} value={r.region_code}>{r.region_name}</option>)}
        </select>
        <select
          value={provinceCode}
          onChange={(e) => handleProvince(e.target.value)}
          disabled={!regionCode}
          className={`${selectClass} appearance-none disabled:bg-slate-50 disabled:text-slate-400 ${invalid && !provinceCode ? errorBorder : normalBorder}`}
        >
          <option value="">Province…</option>
          {provinceOptions.map((p) => <option key={p.province_code} value={p.province_code}>{p.province_name}</option>)}
        </select>
        <select
          value={cityCode}
          onChange={(e) => handleCity(e.target.value)}
          disabled={!provinceCode}
          className={`${selectClass} appearance-none disabled:bg-slate-50 disabled:text-slate-400 ${invalid && !cityCode ? errorBorder : normalBorder}`}
        >
          <option value="">City / Municipality…</option>
          {cityOptions.map((c) => <option key={c.city_code} value={c.city_code}>{c.city_name}</option>)}
        </select>
      </div>
      <input
        value={detail}
        onChange={(e) => handleDetail(e.target.value)}
        maxLength={255}
        placeholder="Barangay, street, building (optional)"
        className={`${selectClass} ${normalBorder}`}
      />
    </div>
  );
}
