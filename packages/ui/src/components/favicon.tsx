import { Link, Meta } from "@solidjs/meta"

export const Favicon = () => {
  return (
    <>
      <Link rel="icon" type="image/png" href="/adpcli-favicon-96.png" sizes="96x96" />
      <Link rel="icon" type="image/svg+xml" href="/adpcli-favicon.svg" />
      <Link rel="shortcut icon" href="/adpcli-favicon.ico" />
      <Link rel="apple-touch-icon" sizes="180x180" href="/adpcli-apple-touch-icon.png" />
      <Link rel="manifest" href="/site.webmanifest" />
      <Meta name="apple-mobile-web-app-title" content="AdpCli" />
    </>
  )
}
