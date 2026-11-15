import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

const PUBLIC = ['/auth/login', '/auth/register', '/auth/refresh'];

const withToken = (req: HttpRequest<unknown>, token: string | null) =>
  token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  // El token solo se envía a nuestra API, nunca a otros orígenes
  const isApi = req.url.startsWith(`${environment.apiUrl}/api/`);
  if (!isApi || PUBLIC.some(p => req.url.endsWith(p))) return next(req);

  return next(withToken(req, auth.accessToken)).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) return throwError(() => err);
      // Access token caducado: se renueva una vez y se repite la petición
      return auth.refresh().pipe(
        catchError(e => {
          auth.logout();
          return throwError(() => e);
        }),
        switchMap(t => next(withToken(req, t.access_token))),
      );
    }),
  );
};
