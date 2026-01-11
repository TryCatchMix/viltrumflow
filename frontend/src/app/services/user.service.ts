import { Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable } from 'rxjs';
import { User, UserUpdate, Message } from '../models';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class UserService {
  private apiUrl = `${environment.apiUrl}/api/v1/users`;

  constructor(private http: HttpClient) {}

  /**
   * Obtener usuario por ID
   */
  getUser(id: number): Observable<User> {
    return this.http.get<User>(`${this.apiUrl}/${id}`);
  }

  /**
   * Actualizar usuario
   */
  updateUser(id: number, user: UserUpdate): Observable<User> {
    return this.http.put<User>(`${this.apiUrl}/${id}`, user);
  }

  /**
   * Cambiar contraseña
   */
  updatePassword(id: number, passwords: { current_password: string; new_password: string }): Observable<Message> {
    return this.http.put<Message>(`${this.apiUrl}/${id}/password`, passwords);
  }

  /**
   * Eliminar usuario
   */
  deleteUser(id: number): Observable<Message> {
    return this.http.delete<Message>(`${this.apiUrl}/${id}`);
  }
}