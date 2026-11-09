const hash = new URLSearchParams(location.hash.slice(1));
const token = hash.get('token');
if (token) {
  sessionStorage.setItem('egent.localToken', token);
  history.replaceState(null, '', location.pathname);
}
export const config = {
  apiBaseUrl: location.origin,
  socketUrl: location.origin,
};
export const desktopContext = {
  localToken: token ?? sessionStorage.getItem('egent.localToken') ?? '',
};
