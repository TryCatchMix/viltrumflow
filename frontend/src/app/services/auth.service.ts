import { BehaviorSubject, Observable, tap } from 'rxjs';
import { LoginRequest, Token, User, UserCreate } from '../models';

import { HttpClient } from '@angular/common/http';
import { Injectable } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private apiUrl = `${environment.apiUrl}/api/v1/auth`;
  private currentUserSubject = new BehaviorSubject<User | null>(null);
  public currentUser$ = this.currentUserSubject.asObservable();

  constructor(
    private http: HttpClient,
    private router: Router
  ) {
    // Cargar usuario si hay token
    this.loadCurrentUser();
  }

  /**
   * Registrar nuevo usuario
   */
  register(user: UserCreate): Observable<User> {
    return this.http.post<User>(`${this.apiUrl}/register`, user);
  }

  /**
   * Login
   */
  login(credentials: LoginRequest): Observable<Token> {
    // Convertir a formato form-data
    const formData = new FormData();
    formData.append('username', credentials.username);
    formData.append('password', credentials.password);

    return this.http.post<Token>(`${this.apiUrl}/login`, formData).pipe(
      tap(token => {
        this.setToken(token.access_token, token.refresh_token);
        this.loadCurrentUser();
      })
    );
  }

  /**
   * Logout
   */
  logout(): void {
    localStorage.removeItem('access_token');
    localStorage.removeItem('refresh_token');
    this.currentUserSubject.next(null);
    this.router.navigate(['/login']);
  }

  /**
   * Obtener usuario actual
   */
  getCurrentUser(): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/me`).pipe(
      tap(user => this.currentUserSubject.next(user))
    );
  }

  /**
   * Refresh token
   */
  refreshToken(): Observable<Token> {
    const refreshToken = this.getRefreshToken();
    return this.http.post<Token>(`${this.apiUrl}/refresh`, {
      refresh_token: refreshToken
    }).pipe(
      tap(token => {
        this.setToken(token.access_token, token.refresh_token);
      })
    );
  }

  /**
   * Guardar tokens
   */
  private setToken(accessToken: string, refreshToken: string): void {
    localStorage.setItem('access_token', accessToken);
    localStorage.setItem('refresh_token', refreshToken);
  }

  /**
   * Obtener access token
   */
  getAccessToken(): string | null {
    return localStorage.getItem('access_token');
  }

  /**
   * Obtener refresh token
   */
  getRefreshToken(): string | null {
    return localStorage.getItem('refresh_token');
  }

  /**
   * Verificar si está autenticado
   */
  isAuthenticated(): boolean {
    return !!this.getAccessToken();
  }

  /**
   * Cargar usuario actual
   */
  private loadCurrentUser(): void {
    if (this.isAuthenticated()) {
      this.getCurrentUser().subscribe({
        error: () => this.logout()
      });
    }
  }

  /**
   * Obtener usuario actual (valor sincrónico)
   */
  get currentUserValue(): User | null {
    return this.currentUserSubject.value;
  }
}
