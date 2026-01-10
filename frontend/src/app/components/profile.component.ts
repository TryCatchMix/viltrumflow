import { Component, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule } from '@angular/forms';
import { AuthService } from '../../services/auth.service';
import { UserService } from '../../services/user.service';
import { User } from '../../models';

@Component({
  selector: 'app-profile',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule],
  template: `
    <div class="profile-page">
      <div class="profile-container">
        <!-- Header -->
        <div class="profile-header">
          <h1>Mi Perfil</h1>
          <p>Gestiona tu información personal y configuración de cuenta</p>
        </div>

        <div class="profile-content">
          <!-- Sidebar con Avatar -->
          <aside class="profile-sidebar">
            <div class="avatar-section">
              <div class="avatar-container">
                <img 
                  [src]="currentUser?.avatar_url || 'https://ui-avatars.com/api/?name=' + (currentUser?.full_name || currentUser?.username) + '&size=200&background=667eea&color=fff'" 
                  [alt]="currentUser?.username"
                  class="avatar-image"
                />
                <button class="avatar-upload-btn" (click)="fileInput.click()">
                  📷
                </button>
                <input 
                  #fileInput
                  type="file" 
                  accept="image/*" 
                  (change)="onAvatarSelected($event)"
                  style="display: none"
                />
              </div>
              <h2>{{ currentUser?.full_name || currentUser?.username }}</h2>
              <p class="user-email">{{ currentUser?.email }}</p>
              <span class="user-role">{{ getRoleLabel(currentUser?.role) }}</span>
            </div>

            <div class="profile-stats">
              <div class="stat">
                <span class="stat-label">Miembro desde</span>
                <span class="stat-value">{{ currentUser?.created_at | date:'MMM yyyy' }}</span>
              </div>
              <div class="stat" *ngIf="currentUser?.last_login">
                <span class="stat-label">Último acceso</span>
                <span class="stat-value">{{ currentUser?.last_login | date:'dd/MM/yyyy HH:mm' }}</span>
              </div>
            </div>
          </aside>

          <!-- Main Content -->
          <main class="profile-main">
            <!-- Tabs -->
            <div class="tabs">
              <button 
                class="tab" 
                [class.active]="activeTab === 'info'"
                (click)="activeTab = 'info'"
              >
                👤 Información Personal
              </button>
              <button 
                class="tab" 
                [class.active]="activeTab === 'security'"
                (click)="activeTab = 'security'"
              >
                🔒 Seguridad
              </button>
            </div>

            <!-- Tab: Información Personal -->
            <div class="tab-content" *ngIf="activeTab === 'info'">
              <form [formGroup]="profileForm" (ngSubmit)="updateProfile()">
                <div class="form-section">
                  <h3>Información Básica</h3>
                  
                  <div class="form-group">
                    <label for="username">Usuario *</label>
                    <input
                      type="text"
                      id="username"
                      formControlName="username"
                      placeholder="usuario123"
                    />
                    <small>Tu nombre de usuario único</small>
                  </div>

                  <div class="form-group">
                    <label for="email">Email *</label>
                    <input
                      type="email"
                      id="email"
                      formControlName="email"
                      placeholder="tu@email.com"
                    />
                  </div>

                  <div class="form-group">
                    <label for="full_name">Nombre Completo</label>
                    <input
                      type="text"
                      id="full_name"
                      formControlName="full_name"
                      placeholder="Juan Pérez"
                    />
                  </div>

                  <div class="form-group">
                    <label for="phone">Teléfono</label>
                    <input
                      type="tel"
                      id="phone"
                      formControlName="phone"
                      placeholder="+34 600 000 000"
                    />
                  </div>

                  <div class="form-group">
                    <label for="bio">Biografía</label>
                    <textarea
                      id="bio"
                      formControlName="bio"
                      placeholder="Cuéntanos sobre ti..."
                      rows="4"
                    ></textarea>
                    <small>{{ profileForm.get('bio')?.value?.length || 0 }} / 500 caracteres</small>
                  </div>
                </div>

                <div class="success-message" *ngIf="profileSuccessMessage">
                  ✓ {{ profileSuccessMessage }}
                </div>

                <div class="error-message" *ngIf="profileErrorMessage">
                  ✗ {{ profileErrorMessage }}
                </div>

                <div class="form-actions">
                  <button type="button" class="btn-secondary" (click)="resetProfileForm()">
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    class="btn-primary" 
                    [disabled]="profileForm.invalid || profileLoading"
                  >
                    <span *ngIf="!profileLoading">Guardar Cambios</span>
                    <span *ngIf="profileLoading">Guardando...</span>
                  </button>
                </div>
              </form>
            </div>

            <!-- Tab: Seguridad -->
            <div class="tab-content" *ngIf="activeTab === 'security'">
              <form [formGroup]="passwordForm" (ngSubmit)="changePassword()">
                <div class="form-section">
                  <h3>Cambiar Contraseña</h3>
                  
                  <div class="form-group">
                    <label for="current_password">Contraseña Actual *</label>
                    <input
                      type="password"
                      id="current_password"
                      formControlName="current_password"
                      placeholder="••••••••"
                    />
                  </div>

                  <div class="form-group">
                    <label for="new_password">Nueva Contraseña *</label>
                    <input
                      type="password"
                      id="new_password"
                      formControlName="new_password"
                      placeholder="••••••••"
                    />
                    <div class="password-requirements" *ngIf="passwordForm.get('new_password')?.touched">
                      <small [class.valid]="hasMinLength">✓ Mínimo 8 caracteres</small>
                      <small [class.valid]="hasUpperCase">✓ Una mayúscula</small>
                      <small [class.valid]="hasLowerCase">✓ Una minúscula</small>
                      <small [class.valid]="hasNumber">✓ Un número</small>
                    </div>
                  </div>

                  <div class="form-group">
                    <label for="confirm_password">Confirmar Nueva Contraseña *</label>
                    <input
                      type="password"
                      id="confirm_password"
                      formControlName="confirm_password"
                      placeholder="••••••••"
                    />
                    <div class="error-message" *ngIf="passwordForm.get('confirm_password')?.touched && passwordForm.errors?.['passwordMismatch']">
                      Las contraseñas no coinciden
                    </div>
                  </div>
                </div>

                <div class="success-message" *ngIf="passwordSuccessMessage">
                  ✓ {{ passwordSuccessMessage }}
                </div>

                <div class="error-message" *ngIf="passwordErrorMessage">
                  ✗ {{ passwordErrorMessage }}
                </div>

                <div class="form-actions">
                  <button type="button" class="btn-secondary" (click)="resetPasswordForm()">
                    Cancelar
                  </button>
                  <button 
                    type="submit" 
                    class="btn-primary" 
                    [disabled]="passwordForm.invalid || passwordLoading"
                  >
                    <span *ngIf="!passwordLoading">Cambiar Contraseña</span>
                    <span *ngIf="passwordLoading">Cambiando...</span>
                  </button>
                </div>
              </form>

              <!-- Información de Seguridad -->
              <div class="security-info">
                <h3>Consejos de Seguridad</h3>
                <ul>
                  <li>🔒 Usa una contraseña única y segura</li>
                  <li>🔄 Cambia tu contraseña regularmente</li>
                  <li>⚠️ No compartas tu contraseña con nadie</li>
                  <li>✉️ Verifica que tu email esté actualizado</li>
                </ul>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .profile-page {
      min-height: 100vh;
      background: #f5f5f5;
      padding: 30px;
    }

    .profile-container {
      max-width: 1200px;
      margin: 0 auto;
    }

    .profile-header {
      margin-bottom: 30px;
    }

    .profile-header h1 {
      margin: 0 0 10px;
      font-size: 32px;
      color: #333;
    }

    .profile-header p {
      margin: 0;
      color: #666;
      font-size: 16px;
    }

    .profile-content {
      display: grid;
      grid-template-columns: 300px 1fr;
      gap: 30px;
    }

    /* Sidebar */
    .profile-sidebar {
      background: white;
      border-radius: 12px;
      padding: 30px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      height: fit-content;
      position: sticky;
      top: 30px;
    }

    .avatar-section {
      text-align: center;
    }

    .avatar-container {
      position: relative;
      width: 150px;
      height: 150px;
      margin: 0 auto 20px;
    }

    .avatar-image {
      width: 100%;
      height: 100%;
      border-radius: 50%;
      object-fit: cover;
      border: 4px solid #667eea;
    }

    .avatar-upload-btn {
      position: absolute;
      bottom: 5px;
      right: 5px;
      width: 40px;
      height: 40px;
      border-radius: 50%;
      background: #667eea;
      border: 3px solid white;
      cursor: pointer;
      font-size: 18px;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: transform 0.2s;
    }

    .avatar-upload-btn:hover {
      transform: scale(1.1);
    }

    .avatar-section h2 {
      margin: 0 0 5px;
      font-size: 22px;
      color: #333;
    }

    .user-email {
      color: #666;
      font-size: 14px;
      margin-bottom: 10px;
      display: block;
    }

    .user-role {
      display: inline-block;
      padding: 6px 12px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border-radius: 12px;
      font-size: 12px;
      font-weight: 600;
      text-transform: uppercase;
    }

    .profile-stats {
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
    }

    .stat {
      display: flex;
      flex-direction: column;
      gap: 5px;
      margin-bottom: 15px;
    }

    .stat-label {
      font-size: 12px;
      color: #999;
      text-transform: uppercase;
      font-weight: 600;
    }

    .stat-value {
      font-size: 14px;
      color: #333;
      font-weight: 500;
    }

    /* Main Content */
    .profile-main {
      background: white;
      border-radius: 12px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.1);
      overflow: hidden;
    }

    .tabs {
      display: flex;
      border-bottom: 2px solid #e0e0e0;
    }

    .tab {
      flex: 1;
      padding: 20px;
      background: none;
      border: none;
      font-size: 15px;
      font-weight: 600;
      color: #666;
      cursor: pointer;
      transition: all 0.3s;
      border-bottom: 3px solid transparent;
      margin-bottom: -2px;
    }

    .tab:hover {
      color: #667eea;
      background: #f9f9f9;
    }

    .tab.active {
      color: #667eea;
      border-bottom-color: #667eea;
    }

    .tab-content {
      padding: 30px;
    }

    .form-section {
      margin-bottom: 30px;
    }

    .form-section h3 {
      margin: 0 0 20px;
      font-size: 18px;
      color: #333;
      padding-bottom: 10px;
      border-bottom: 2px solid #f0f0f0;
    }

    .form-group {
      margin-bottom: 20px;
    }

    .form-group label {
      display: block;
      margin-bottom: 8px;
      font-weight: 500;
      color: #333;
      font-size: 14px;
    }

    .form-group input,
    .form-group textarea {
      width: 100%;
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.3s;
      box-sizing: border-box;
      font-family: inherit;
    }

    .form-group input:focus,
    .form-group textarea:focus {
      outline: none;
      border-color: #667eea;
    }

    .form-group small {
      display: block;
      margin-top: 5px;
      color: #999;
      font-size: 12px;
    }

    .password-requirements {
      margin-top: 10px;
      display: flex;
      flex-direction: column;
      gap: 5px;
    }

    .password-requirements small {
      font-size: 12px;
      color: #999;
      transition: color 0.3s;
    }

    .password-requirements small.valid {
      color: #4caf50;
      font-weight: 500;
    }

    .success-message {
      padding: 12px 16px;
      background: #e8f5e9;
      color: #388e3c;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }

    .error-message {
      padding: 12px 16px;
      background: #ffebee;
      color: #c62828;
      border-radius: 8px;
      margin-bottom: 20px;
      font-size: 14px;
    }

    .form-actions {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 30px;
      padding-top: 20px;
      border-top: 1px solid #e0e0e0;
    }

    .btn-primary,
    .btn-secondary {
      padding: 12px 24px;
      border: none;
      border-radius: 8px;
      font-size: 14px;
      font-weight: 600;
      cursor: pointer;
      transition: all 0.2s;
    }

    .btn-primary {
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
    }

    .btn-primary:hover:not(:disabled) {
      transform: translateY(-2px);
      box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
    }

    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .btn-secondary {
      background: #e0e0e0;
      color: #333;
    }

    .btn-secondary:hover {
      background: #d0d0d0;
    }

    .security-info {
      margin-top: 40px;
      padding: 20px;
      background: #f9f9f9;
      border-radius: 8px;
      border-left: 4px solid #667eea;
    }

    .security-info h3 {
      margin: 0 0 15px;
      font-size: 16px;
      color: #333;
    }

    .security-info ul {
      margin: 0;
      padding-left: 20px;
    }

    .security-info li {
      margin-bottom: 10px;
      color: #666;
      line-height: 1.5;
    }

    @media (max-width: 768px) {
      .profile-content {
        grid-template-columns: 1fr;
      }

      .profile-sidebar {
        position: static;
      }
    }
  `]
})
export class ProfileComponent implements OnInit {
  currentUser: User | null = null;
  activeTab: 'info' | 'security' = 'info';

  profileForm: FormGroup;
  passwordForm: FormGroup;

  profileLoading = false;
  passwordLoading = false;

  profileSuccessMessage = '';
  profileErrorMessage = '';
  passwordSuccessMessage = '';
  passwordErrorMessage = '';

  // Password validation flags
  hasMinLength = false;
  hasUpperCase = false;
  hasLowerCase = false;
  hasNumber = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private userService: UserService
  ) {
    this.profileForm = this.fb.group({
      username: ['', [Validators.required, Validators.minLength(3)]],
      email: ['', [Validators.required, Validators.email]],
      full_name: [''],
      phone: [''],
      bio: ['', Validators.maxLength(500)]
    });

    this.passwordForm = this.fb.group({
      current_password: ['', Validators.required],
      new_password: ['', [Validators.required, Validators.minLength(8)]],
      confirm_password: ['', Validators.required]
    }, { validators: this.passwordMatchValidator });

    // Watch password changes
    this.passwordForm.get('new_password')?.valueChanges.subscribe(password => {
      this.updatePasswordValidation(password);
    });
  }

  ngOnInit(): void {
    this.loadUserProfile();
  }

  loadUserProfile(): void {
    this.authService.currentUser$.subscribe(user => {
      if (user) {
        this.currentUser = user;
        this.profileForm.patchValue({
          username: user.username,
          email: user.email,
          full_name: user.full_name || '',
          phone: user.phone || '',
          bio: user.bio || ''
        });
      }
    });
  }

  updateProfile(): void {
    if (this.profileForm.invalid || !this.currentUser) {
      return;
    }

    this.profileLoading = true;
    this.profileSuccessMessage = '';
    this.profileErrorMessage = '';

    this.userService.updateUser(this.currentUser.id, this.profileForm.value).subscribe({
      next: (user) => {
        this.profileLoading = false;
        this.profileSuccessMessage = 'Perfil actualizado exitosamente';
        
        // Actualizar usuario actual
        this.authService.getCurrentUser().subscribe();
        
        setTimeout(() => {
          this.profileSuccessMessage = '';
        }, 3000);
      },
      error: (error) => {
        this.profileLoading = false;
        this.profileErrorMessage = error.error?.detail || 'Error al actualizar el perfil';
      }
    });
  }

  changePassword(): void {
    if (this.passwordForm.invalid || !this.currentUser) {
      return;
    }

    this.passwordLoading = true;
    this.passwordSuccessMessage = '';
    this.passwordErrorMessage = '';

    const { current_password, new_password } = this.passwordForm.value;

    this.userService.updatePassword(this.currentUser.id, {
      current_password,
      new_password
    }).subscribe({
      next: () => {
        this.passwordLoading = false;
        this.passwordSuccessMessage = 'Contraseña cambiada exitosamente';
        this.resetPasswordForm();
        
        setTimeout(() => {
          this.passwordSuccessMessage = '';
        }, 3000);
      },
      error: (error) => {
        this.passwordLoading = false;
        this.passwordErrorMessage = error.error?.detail || 'Error al cambiar la contraseña';
      }
    });
  }

  onAvatarSelected(event: any): void {
    const file = event.target.files[0];
    if (!file) return;

    // Validar tipo de archivo
    if (!file.type.startsWith('image/')) {
      alert('Por favor selecciona una imagen válida');
      return;
    }

    // Validar tamaño (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('La imagen no puede ser mayor a 2MB');
      return;
    }

    // Convertir a base64 y actualizar
    const reader = new FileReader();
    reader.onload = (e: any) => {
      const avatar_url = e.target.result;
      
      if (this.currentUser) {
        this.userService.updateUser(this.currentUser.id, { avatar_url }).subscribe({
          next: (user) => {
            this.authService.getCurrentUser().subscribe();
            this.profileSuccessMessage = 'Avatar actualizado exitosamente';
            setTimeout(() => {
              this.profileSuccessMessage = '';
            }, 3000);
          },
          error: (error) => {
            this.profileErrorMessage = 'Error al actualizar el avatar';
          }
        });
      }
    };
    reader.readAsDataURL(file);
  }

  resetProfileForm(): void {
    this.loadUserProfile();
    this.profileSuccessMessage = '';
    this.profileErrorMessage = '';
  }

  resetPasswordForm(): void {
    this.passwordForm.reset();
    this.passwordSuccessMessage = '';
    this.passwordErrorMessage = '';
  }

  passwordMatchValidator(form: FormGroup): { [key: string]: boolean } | null {
    const newPassword = form.get('new_password');
    const confirmPassword = form.get('confirm_password');

    if (!newPassword || !confirmPassword) {
      return null;
    }

    return newPassword.value === confirmPassword.value ? null : { passwordMismatch: true };
  }

  updatePasswordValidation(password: string): void {
    this.hasMinLength = password.length >= 8;
    this.hasUpperCase = /[A-Z]/.test(password);
    this.hasLowerCase = /[a-z]/.test(password);
    this.hasNumber = /[0-9]/.test(password);
  }

  getRoleLabel(role: string | undefined): string {
    const labels: Record<string, string> = {
      'admin': 'Administrador',
      'manager': 'Manager',
      'user': 'Usuario',
      'guest': 'Invitado'
    };
    return labels[role || 'user'] || 'Usuario';
  }
}