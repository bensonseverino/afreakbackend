import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useProducts } from "../hooks/useStorefront";
import { EmptyState, ErrorState, Spinner } from "../components/ui";
import { ProductCard } from "./components";

const SORTS = [
  ["popular", "Most popular"],
  ["newest", "Newest"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
];

const SIZE_TYPE_LABELS = {
  apparel: "Apparel",
  print: "Prints",
  one_size: "One size",
};

function csv(value) {
  return (value ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

function FilterGroup({ title, children }) {
  return (
    <div className="border-b border-line py-5 first:pt-0">
      <p className="label mb-3 text-stone">{title}</p>
      {children}
    </div>
  );
}

function CheckRow({ checked, label, hint, onChange }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 py-1 text-[13px]">
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5 accent-ink" />
      <span className={checked ? "text-ink" : "text-graphite"}>{label}</span>
      {hint != null && <span className="ml-auto text-[11px] text-stone">{hint}</span>}
    </label>
  );
}

export default function Shop() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [search, setSearch] = useState(searchParams.get("q") ?? "");

  const get = (key) => searchParams.get(key) ?? "";
  const category = get("category");
  const sizeType = get("sizeType");
  const sort = get("sort") || "popular";
  const selectedColors = csv(get("colors"));
  const selectedSizes = csv(get("sizes"));
  const page = Math.max(1, Number(get("page")) || 1);
  const isNew = get("new") === "1";

  const params = {
    category,
    colors: selectedColors.join(","),
    sizes: selectedSizes.join(","),
    sizeType,
    sort,
    page,
    q: get("q"),
    new: isNew ? "1" : "",
    limit: 24,
  };

  const products = useProducts(params);
  const payload = products.data;
  const cards = payload?.data ?? [];
  const meta = payload?.meta ?? {};
  const facets = meta.facets ?? null;
  const total = meta.total ?? cards.length;
  const pages = meta.pages ?? 1;

  const update = (patch) => {
    const next = new URLSearchParams(searchParams);
    for (const [key, value] of Object.entries(patch)) {
      if (value == null || value === "") next.delete(key);
      else next.set(key, String(value));
    }
    if (!("page" in patch)) next.delete("page");
    setSearchParams(next, { replace: true });
  };

  const toggle = (key, list, value) => {
    const next = list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
    update({ [key]: next.join(",") });
  };

  const reset = () => {
    setSearch("");
    setSearchParams(new URLSearchParams(), { replace: true });
  };

  const filters = facets && (
    <div>
      <FilterGroup title="Category">
        <CheckRow
          checked={!category}
          label="All products"
          onChange={() => update({ category: "" })}
        />
        {(facets.categories ?? []).map((cat) => (
          <CheckRow
            key={cat.slug}
            checked={category === cat.slug}
            label={cat.name}
            hint={cat.count}
            onChange={() => update({ category: category === cat.slug ? "" : cat.slug })}
          />
        ))}
      </FilterGroup>

      <FilterGroup title="Type">
        <CheckRow
          checked={!sizeType}
          label="Everything"
          onChange={() => update({ sizeType: "" })}
        />
        {(facets.sizeTypes ?? []).map((type) => (
          <CheckRow
            key={type}
            checked={sizeType === type}
            label={SIZE_TYPE_LABELS[type] ?? type}
            onChange={() => update({ sizeType: sizeType === type ? "" : type })}
          />
        ))}
      </FilterGroup>

      {(facets.colors ?? []).length > 0 && (
        <FilterGroup title="Colour">
          <div className="space-y-0.5">
            {facets.colors.map((color) => {
              const checked = selectedColors.includes(color.name);
              return (
                <label key={color.name} className="flex cursor-pointer items-center gap-2 py-1 text-[13px]">
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle("colors", selectedColors, color.name)}
                    className="h-3.5 w-3.5 accent-ink"
                  />
                  <span className="h-3 w-3 border border-line" style={{ backgroundColor: color.hex }} />
                  <span className={checked ? "text-ink" : "text-graphite"}>{color.name}</span>
                </label>
              );
            })}
          </div>
        </FilterGroup>
      )}

      {(facets.sizes ?? []).length > 0 && (
        <FilterGroup title="Size">
          <div className="flex flex-wrap gap-1.5">
            {facets.sizes.map((size) => {
              const checked = selectedSizes.includes(size);
              return (
                <button
                  key={size}
                  onClick={() => toggle("sizes", selectedSizes, size)}
                  className={`min-w-[40px] border px-2 py-1.5 text-[12px] uppercase ${
                    checked ? "border-ink bg-ink text-paper" : "border-line text-graphite hover:border-ink"
                  }`}
                >
                  {size}
                </button>
              );
            })}
          </div>
        </FilterGroup>
      )}

      <button onClick={reset} className="label mt-5 text-stone underline hover:text-ink">
        Clear filters
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 sm:py-12">
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="label mb-2 text-stone">{isNew ? "Just landed" : "Collection"}</p>
          <h1 className="font-display text-[30px] font-extrabold uppercase tracking-tight sm:text-[40px]">
            {sizeType === "print" ? "Prints" : isNew ? "New in" : "Shop all"}
          </h1>
          <p className="mt-2 text-[13px] text-stone">
            {products.isLoading ? "Loading…" : `${total} ${total === 1 ? "product" : "products"}`}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            className="label border border-line px-3 py-2.5 lg:hidden"
            onClick={() => setFiltersOpen((open) => !open)}
          >
            Filters
          </button>
          <label className="label flex items-center gap-2 border border-line px-3 py-2.5">
            <span className="text-stone">Sort</span>
            <select
              value={sort}
              onChange={(event) => update({ sort: event.target.value })}
              className="bg-transparent text-[12px] uppercase tracking-[0.08em] outline-none"
            >
              {SORTS.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <form
        className="mb-8 flex max-w-[420px] items-stretch border border-line"
        onSubmit={(event) => {
          event.preventDefault();
          update({ q: search.trim() });
        }}
      >
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search products"
          className="min-w-0 flex-1 bg-transparent px-3 py-2.5 text-[14px] outline-none"
        />
        <button type="submit" className="label border-l border-line px-4 text-graphite hover:text-ink">
          Search
        </button>
      </form>

      <div className="grid gap-8 lg:grid-cols-[220px_1fr]">
        <aside className={`${filtersOpen ? "block" : "hidden"} lg:block`}>
          <div className="lg:sticky lg:top-20">{filters ?? <Spinner />}</div>
        </aside>

        <div>
          {products.isLoading && <Spinner label="Loading products" />}
          {products.error && <ErrorState error={products.error} onRetry={products.refetch} />}

          {!products.isLoading && !products.error && cards.length === 0 && (
            <EmptyState
              title="Nothing matches"
              hint="Try removing a filter or searching for something else."
              action={
                <button onClick={reset} className="label border border-ink px-5 py-3 hover:bg-ink hover:text-paper">
                  Clear filters
                </button>
              }
            />
          )}

          {cards.length > 0 && (
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3">
              {cards.map((card) => (
                <ProductCard key={card.id} card={card} />
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="mt-12 flex items-center justify-between border-t border-line pt-5">
              <span className="label text-stone">
                Page {page} / {pages}
              </span>
              <div className="flex gap-2">
                <button
                  disabled={page <= 1}
                  onClick={() => update({ page: page - 1 })}
                  className="label border border-line px-4 py-2.5 disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  disabled={page >= pages}
                  onClick={() => update({ page: page + 1 })}
                  className="label border border-line px-4 py-2.5 disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <p className="mt-14 text-center text-[12px] text-stone">
        Need sizing help?{" "}
        <Link to="/size-guide" className="text-ink underline">
          Read the size guide
        </Link>
      </p>
    </div>
  );
}
