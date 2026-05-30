/** Ẩn field để trình duyệt không gán Path/URL thành username/password. */
export function PasswordManagerTrap() {
  return (
    <>
      <input
        type="text"
        name="gw-decoy-username"
        autoComplete="username"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none fixed left-[-9999px] h-px w-px opacity-0"
        defaultValue=""
        readOnly
      />
      <input
        type="password"
        name="gw-decoy-password"
        autoComplete="current-password"
        tabIndex={-1}
        aria-hidden
        className="pointer-events-none fixed left-[-9999px] h-px w-px opacity-0"
        defaultValue=""
        readOnly
      />
    </>
  );
}
