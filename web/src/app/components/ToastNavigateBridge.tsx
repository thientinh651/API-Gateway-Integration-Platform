import { useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { registerToastNavigator, scrollToAppSection } from '../../lib/toastNavigation';

/** Kết nối react-router với toast “xem chỗ lỗi”. */
export function ToastNavigateBridge() {
  const navigate = useNavigate();
  const location = useLocation();
  const locationRef = useRef(location);
  locationRef.current = location;

  useEffect(() => {
    registerToastNavigator((route, sectionId) => {
      const onSamePage = locationRef.current.pathname === route;
      if (onSamePage && sectionId) {
        scrollToAppSection(sectionId);
        return;
      }
      navigate(sectionId ? `${route}#${sectionId}` : route);
    });
  }, [navigate]);

  useEffect(() => {
    const id = location.hash.replace(/^#/, '').trim();
    if (!id) return;
    scrollToAppSection(id);
  }, [location.pathname, location.hash]);

  return null;
}
