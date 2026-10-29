import { Link } from "react-router";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-[620px] px-4 py-24 text-center sm:px-6">
      <p className="label mb-3 text-stone">404</p>
      <h1 className="font-display text-[30px] font-extrabold uppercase tracking-tight">
        This page doesn't exist
      </h1>
      <p className="mt-3 text-[13px] text-graphite">
        The link may be broken, or the product is no longer available.
      </p>
      <Link to="/shop" className="label mt-8 inline-block bg-ink px-6 py-4 text-paper hover:bg-graphite">
        Back to the shop
      </Link>
    </div>
  );
}
