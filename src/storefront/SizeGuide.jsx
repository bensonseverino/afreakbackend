import { Link, useSearchParams } from "react-router";
import { useProduct } from "../hooks/useStorefront";
import { Spinner } from "../components/ui";
import { useStore } from "./context";

function PrintTable({ sizeMeta }) {
  const rows = Object.entries(sizeMeta ?? {});
  if (!rows.length) return null;
  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full min-w-[420px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-mist">
            <th className="label px-4 py-3 text-stone">Size</th>
            <th className="label px-4 py-3 text-stone">Millimetres</th>
            <th className="label px-4 py-3 text-stone">Inches</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, dims]) => (
            <tr key={label} className="border-b border-line last:border-0">
              <td className="px-4 py-3 text-[13px] font-medium uppercase">{label}</td>
              <td className="px-4 py-3 text-[13px] tabular-nums text-graphite">
                {dims?.mm ? `${dims.mm[0]} × ${dims.mm[1]} mm` : "—"}
              </td>
              <td className="px-4 py-3 text-[13px] tabular-nums text-graphite">
                {dims?.in ? `${dims.in[0]} × ${dims.in[1]} in` : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ChartTable({ chart }) {
  const sizes = chart.sizes ?? [];
  const rows = Object.entries(chart.measurements ?? {});
  if (!sizes.length) return null;
  return (
    <div className="overflow-x-auto border border-line">
      <table className="w-full min-w-[520px] border-collapse text-left">
        <thead>
          <tr className="border-b border-line bg-mist">
            <th className="label px-4 py-3 text-stone">Measurement</th>
            {sizes.map((size) => (
              <th key={size} className="label px-4 py-3 text-stone">
                {size}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map(([name, values]) => (
            <tr key={name} className="border-b border-line last:border-0">
              <td className="px-4 py-3 text-[13px] font-medium">{name}</td>
              {(Array.isArray(values) ? values : []).map((value, index) => (
                <td key={index} className="px-4 py-3 text-[13px] tabular-nums text-graphite">
                  {value === "" || value == null ? "—" : value}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function SizeGuide() {
  const [searchParams] = useSearchParams();
  const slug = searchParams.get("product");
  const { settings } = useStore();
  const productQuery = useProduct(slug || undefined);
  const product = slug ? productQuery.data : null;

  const presets = settings?.sizePresets ?? { apparel: [], print: [], one_size: [] };
  const sizeMeta = settings?.sizeMeta ?? {};

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6 sm:py-14">
      <p className="label mb-2 text-stone">Fit</p>
      <h1 className="font-display text-[30px] font-extrabold uppercase tracking-tight sm:text-[40px]">
        Size guide
      </h1>
      <p className="mt-3 max-w-[60ch] text-[14px] leading-relaxed text-graphite">
        Garment measurements are taken flat, in the unit shown. Print sizes follow the ISO A-series,
        measured in millimetres and inches.
      </p>

      {slug && (
        <section className="mt-10">
          {productQuery.isLoading && <Spinner label="Loading product measurements" />}
          {!productQuery.isLoading && product?.sizeChart && (
            <>
              <h2 className="font-display text-[20px] font-extrabold uppercase tracking-tight">
                {product.name} — {product.sizeChart.title}
              </h2>
              <p className="mb-4 mt-1 text-[12px] text-stone">Measurements in {product.sizeChart.unit}</p>
              <ChartTable chart={product.sizeChart} />
              <p className="mt-4 text-[12px] text-stone">
                <Link to={`/product/${product.slug}`} className="text-ink underline">
                  Back to {product.name}
                </Link>
              </p>
            </>
          )}
          {!productQuery.isLoading && product && !product.sizeChart && (
            <p className="border border-line bg-mist px-4 py-3 text-[13px] text-graphite">
              {product.name} has no measurement chart. Use the tables below.
            </p>
          )}
        </section>
      )}


      {Object.keys(sizeMeta).length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-[20px] font-extrabold uppercase tracking-tight">
            Print sizes
          </h2>
          <PrintTable sizeMeta={sizeMeta} />
          <p className="mt-3 text-[12px] text-stone">
            Every print size has its own price, shown on the product page.{" "}
            <Link to="/shop?sizeType=print" className="text-ink underline">
              Shop prints
            </Link>
          </p>
        </section>
      )}

      {(presets.apparel ?? []).length > 0 && (
        <section className="mt-10">
          <h2 className="mb-4 font-display text-[20px] font-extrabold uppercase tracking-tight">
            Apparel sizes
          </h2>
          <p className="text-[13px] text-graphite">
            Available sizes: <span className="text-ink">{(presets.apparel ?? []).join(" · ")}</span>
          </p>
          <p className="mt-3 text-[12px] text-stone">
            Between two sizes? Size up for a relaxed fit. Each product page lists the exact sizes in
            stock.
          </p>
        </section>
      )}
    </div>
  );
}
