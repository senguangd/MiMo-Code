import { ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 16 20"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path data-slot="logo-logo-mark-shadow" d="M12 16H4V8H12V16Z" fill="var(--icon-weak-base)" />
      <path data-slot="logo-logo-mark-o" d="M12 4H4V16H12V4ZM16 20H0V0H16V20Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 80 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M60 80H20V40H60V80Z" fill="var(--icon-base)" />
      <path d="M60 20H20V80H60V20ZM80 100H0V0H80V100Z" fill="var(--icon-strong-base)" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 192 42"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g>
        <path d="M18 30H6V24H18V30Z" fill="var(--icon-weak-base)" />
        <path d="M6 6H18V12H6V6ZM0 36V12H6V36H0ZM18 36V12H24V36H18ZM0 18H24V24H0V18Z" fill="var(--icon-base)" />

        <path d="M18 30H6V18H18V30Z" transform="translate(30 0)" fill="var(--icon-weak-base)" />
        <path d="M0 6H18V12H0V6ZM0 36V6H6V36H0ZM18 30V12H24V30H18ZM6 30H18V36H6V30Z" transform="translate(30 0)" fill="var(--icon-base)" />

        <path d="M18 24H6V18H18V24Z" transform="translate(60 0)" fill="var(--icon-weak-base)" />
        <path d="M0 36V6H6V36H0ZM6 6H24V12H6V6ZM18 24V12H24V24H18ZM6 24H24V30H6V24Z" transform="translate(60 0)" fill="var(--icon-base)" />

        <path d="M24 30H6V18H24V30Z" transform="translate(108 0)" fill="var(--icon-weak-base)" />
        <path d="M24 12H6V30H24V36H0V6H24V12Z" transform="translate(108 0)" fill="var(--icon-strong-base)" />

        <path d="M24 30H6V24H24V30Z" transform="translate(138 0)" fill="var(--icon-weak-base)" />
        <path d="M0 6H6V30H24V36H0V6Z" transform="translate(138 0)" fill="var(--icon-strong-base)" />

        <path d="M18 30H12V18H18V30Z" transform="translate(168 0)" fill="var(--icon-weak-base)" />
        <path d="M0 6H24V12H0V6ZM6 12H12V30H6V12ZM0 30H24V36H0V30Z" transform="translate(168 0)" fill="var(--icon-strong-base)" />
      </g>
    </svg>
  )
}
