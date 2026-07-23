import { ComponentProps } from "solid-js"

const BrandMark = (props: Pick<ComponentProps<"svg">, "ref" | "class"> & { tile?: boolean; component: string }) => (
  <svg
    ref={props.ref}
    data-component={props.component}
    classList={{ [props.class ?? ""]: !!props.class }}
    viewBox="0 0 1024 1024"
    fill="none"
    xmlns="http://www.w3.org/2000/svg"
  >
    {props.tile && <rect x="76.8" y="76.8" width="870.4" height="870.4" rx="150" fill="var(--background-base)" />}
    <g fill="#F5C428">
      <rect x="461" y="166" width="61" height="148.5" rx="30.5" />
      <rect x="291.8" y="310.5" width="164" height="61" rx="30.5" transform="rotate(34 373.8 341)" />
      <rect x="527.3" y="310.5" width="164" height="61" rx="30.5" transform="rotate(-34 609.3 341)" />
      <rect x="291.8" y="435.5" width="164" height="61" rx="30.5" transform="rotate(-34 373.8 466)" />
      <rect x="527.3" y="435.5" width="164" height="61" rx="30.5" transform="rotate(34 609.3 466)" />
      <rect x="291.8" y="560.5" width="164" height="61" rx="30.5" transform="rotate(34 373.8 591)" />
      <rect x="527.3" y="560.5" width="164" height="61" rx="30.5" transform="rotate(-34 609.3 591)" />
      <rect x="291.8" y="685.5" width="164" height="61" rx="30.5" transform="rotate(-34 373.8 716)" />
      <rect x="527.3" y="685.5" width="164" height="61" rx="30.5" transform="rotate(34 609.3 716)" />
      <rect x="461" y="742" width="61" height="148.5" rx="30.5" />
    </g>
    <g fill="none" stroke="#0E4F63" stroke-linecap="round" stroke-linejoin="round">
      <path d="M726 632L826 728L726 824" stroke-width="52" />
      <path d="M796 856H856" stroke-width="46" />
    </g>
  </svg>
)

export const Mark = (props: { class?: string }) => <BrandMark component="logo-mark" class={props.class} />

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => (
  <BrandMark ref={props.ref} component="logo-splash" class={props.class} tile />
)

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 192 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
      aria-label="AdpCli"
    >
      <g>
        <path d="M18 30H6V24H18V30Z" fill="var(--icon-weak-base)" />
        <path d="M6 6H18V12H6V6ZM0 36V12H6V36H0ZM18 36V12H24V36H18ZM0 18H24V24H0V18Z" fill="var(--icon-base)" />
        <path d="M18 30H6V18H18V30Z" transform="translate(30 0)" fill="var(--icon-weak-base)" />
        <path
          d="M0 6H18V12H0V6ZM0 36V6H6V36H0ZM18 30V12H24V30H18ZM6 30H18V36H6V30Z"
          transform="translate(30 0)"
          fill="var(--icon-base)"
        />
        <path d="M18 24H6V18H18V24Z" transform="translate(60 0)" fill="var(--icon-weak-base)" />
        <path
          d="M0 36V6H6V36H0ZM6 6H24V12H6V6ZM18 24V12H24V24H18ZM6 24H24V30H6V24Z"
          transform="translate(60 0)"
          fill="var(--icon-base)"
        />
        <path d="M24 30H6V18H24V30Z" transform="translate(108 0)" fill="var(--icon-weak-base)" />
        <path d="M24 12H6V30H24V36H0V6H24V12Z" transform="translate(108 0)" fill="var(--icon-strong-base)" />
        <path d="M24 30H6V24H24V30Z" transform="translate(138 0)" fill="var(--icon-weak-base)" />
        <path d="M0 6H6V30H24V36H0V6Z" transform="translate(138 0)" fill="var(--icon-strong-base)" />
        <path d="M18 30H12V18H18V30Z" transform="translate(168 0)" fill="var(--icon-weak-base)" />
        <path
          d="M0 6H24V12H0V6ZM6 12H12V30H6V12ZM0 30H24V36H0V30Z"
          transform="translate(168 0)"
          fill="var(--icon-strong-base)"
        />
      </g>
    </svg>
  )
}
