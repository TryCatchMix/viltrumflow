import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormBuilder, FormGroup, Validators, ReactiveFormsModule, AbstractControl, ValidationErrors } from '@angular/forms';
import { Router, RouterModule } from '@angular/router';
import { AuthService } from '../../services/auth.service';

@Component({
  selector: 'app-register',
  standalone: true,
  imports: [CommonModule, ReactiveFormsModule, RouterModule],
  template: `
    <div class="register-container">
      <div class="register-card">
        <div class="logo">
          <h1>ViltrumFlow</h1>
          <p>Crea tu cuenta</p>
        </div>

        <form [formGroup]="registerForm" (ngSubmit)="onSubmit()">
          <!-- Email -->
          <div class="form-group">
            <label for="email">Email *</label>
            <input
              type="email"
              id="email"
              formControlName="email"
              placeholder="tu@email.com"
              [class.error]="registerForm.get('email')?.invalid && registerForm.get('email')?.touched"
            />
            <div class="error-message" *ngIf="registerForm.get('email')?.invalid && registerForm.get('email')?.touched">
              <span *ngIf="registerForm.get('email')?.errors?.['required']">Email es requerido</span>
              <span *ngIf="registerForm.get('email')?.errors?.['email']">Email inválido</span>
            </div>
          </div>

          <!-- Username -->
          <div class="form-group">
            <label for="username">Usuario *</label>
            <input
              type="text"
              id="username"
              formControlName="username"
              placeholder="usuario123"
              [class.error]="registerForm.get('username')?.invalid && registerForm.get('username')?.touched"
            />
            <div class="error-message" *ngIf="registerForm.get('username')?.invalid && registerForm.get('username')?.touched">
              <span *ngIf="registerForm.get('username')?.errors?.['required']">Usuario es requerido</span>
              <span *ngIf="registerForm.get('username')?.errors?.['minlength']">Mínimo 3 caracteres</span>
            </div>
          </div>

          <!-- Full Name -->
          <div class="form-group">
            <label for="full_name">Nombre Completo</label>
            <input
              type="text"
              id="full_name"
              formControlName="full_name"
              placeholder="Tu nombre completo"
            />
          </div>

          <!-- Password -->
          <div class="form-group">
            <label for="password">Contraseña *</label>
            <input
              type="password"
              id="password"
              formControlName="password"
              placeholder="••••••••"
              [class.error]="registerForm.get('password')?.invalid && registerForm.get('password')?.touched"
            />
            <div class="password-requirements" *ngIf="registerForm.get('password')?.touched">
              <small [class.valid]="hasMinLength">✓ Mínimo 8 caracteres</small>
              <small [class.valid]="hasUpperCase">✓ Una mayúscula</small>
              <small [class.valid]="hasLowerCase">✓ Una minúscula</small>
              <small [class.valid]="hasNumber">✓ Un número</small>
            </div>
          </div>

          <!-- Confirm Password -->
          <div class="form-group">
            <label for="confirmPassword">Confirmar Contraseña *</label>
            <input
              type="password"
              id="confirmPassword"
              formControlName="confirmPassword"
              placeholder="••••••••"
              [class.error]="registerForm.get('confirmPassword')?.invalid && registerForm.get('confirmPassword')?.touched"
            />
            <div class="error-message" *ngIf="registerForm.get('confirmPassword')?.invalid && registerForm.get('confirmPassword')?.touched">
              <span *ngIf="registerForm.get('confirmPassword')?.errors?.['required']">Confirma tu contraseña</span>
              <span *ngIf="registerForm.errors?.['passwordMismatch']">Las contraseñas no coinciden</span>
            </div>
          </div>

          <!-- Phone (optional) -->
          <div class="form-group">
            <label for="phone">Teléfono</label>
            <input
              type="tel"
              id="phone"
              formControlName="phone"
              placeholder="+34 600 000 000"
            />
          </div>

          <!-- Error Message -->
          <div class="error-message" *ngIf="errorMessage">
            {{ errorMessage }}
          </div>

          <!-- Success Message -->
          <div class="success-message" *ngIf="successMessage">
            {{ successMessage }}
          </div>

          <!-- Submit Button -->
          <button 
            type="submit" 
            class="btn-primary" 
            [disabled]="registerForm.invalid || loading"
          >
            <span *ngIf="!loading">Crear Cuenta</span>
            <span *ngIf="loading">Creando cuenta...</span>
          </button>
        </form>

        <div class="login-link">
          <p>¿Ya tienes cuenta? <a [routerLink]="['/login']">Inicia sesión aquí</a></p>
        </div>
      </div>
    </div>
  `,
  styles: [`
    .register-container {
      min-height: 100vh;
      display: flex;
      align-items: center;
      justify-content: center;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      padding: 20px;
    }

    .register-card {
      background: white;
      padding: 40px;
      border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
      width: 100%;
      max-width: 500px;
      max-height: 90vh;
      overflow-y: auto;
    }

    .logo {
      text-align: center;
      margin-bottom: 30px;
    }

    .logo h1 {
      margin: 0;
      font-size: 32px;
      color: #667eea;
      font-weight: 700;
    }

    .logo p {
      margin: 5px 0 0;
      color: #666;
      font-size: 14px;
    }

    .form-group {
      margin-bottom: 20px;
    }

    label {
      display: block;
      margin-bottom: 8px;
      color: #333;
      font-weight: 500;
      font-size: 14px;
    }

    input {
      width: 100%;
      padding: 12px;
      border: 2px solid #e0e0e0;
      border-radius: 8px;
      font-size: 14px;
      transition: border-color 0.3s;
      box-sizing: border-box;
    }

    input:focus {
      outline: none;
      border-color: #667eea;
    }

    input.error {
      border-color: #f44336;
    }

    .error-message {
      color: #f44336;
      font-size: 12px;
      margin-top: 5px;
    }

    .success-message {
      color: #4caf50;
      font-size: 14px;
      margin-bottom: 15px;
      padding: 12px;
      background: #e8f5e9;
      border-radius: 8px;
      text-align: center;
    }

    .password-requirements {
      margin-top: 8px;
      display: flex;
      flex-direction: column;
      gap: 4px;
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

    .btn-primary {
      width: 100%;
      padding: 14px;
      background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
      color: white;
      border: none;
      border-radius: 8px;
      font-size: 16px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.2s;
      margin-top: 10px;
    }

    .btn-primary:hover:not(:disabled) {
      transform: translateY(-2px);
    }

    .btn-primary:disabled {
      opacity: 0.6;
      cursor: not-allowed;
    }

    .login-link {
      text-align: center;
      margin-top: 20px;
      font-size: 14px;
    }

    .login-link a {
      color: #667eea;
      text-decoration: none;
      font-weight: 600;
    }

    .login-link a:hover {
      text-decoration: underline;
    }

    /* Scrollbar personalizado para el card */
    .register-card::-webkit-scrollbar {
      width: 8px;
    }

    .register-card::-webkit-scrollbar-track {
      background: #f1f1f1;
      border-radius: 10px;
    }

    .register-card::-webkit-scrollbar-thumb {
      background: #667eea;
      border-radius: 10px;
    }

    .register-card::-webkit-scrollbar-thumb:hover {
      background: #5568d3;
    }
  `]
})
export class RegisterComponent {
  registerForm: FormGroup;
  loading = false;
  errorMessage = '';
  successMessage = '';

  // Password validation flags
  hasMinLength = false;
  hasUpperCase = false;
  hasLowerCase = false;
  hasNumber = false;

  constructor(
    private fb: FormBuilder,
    private authService: AuthService,
    private router: Router
  ) {
    this.registerForm = this.fb.group({
      email: ['', [Validators.required, Validators.email]],
      username: ['', [Validators.required, Validators.minLength(3)]],
      full_name: [''],
      password: ['', [Validators.required, Validators.minLength(8), this.passwordValidator.bind(this)]],
      confirmPassword: ['', Validators.required],
      phone: ['']
    }, { validators: this.passwordMatchValidator });

    // Watch password changes for visual feedback
    this.registerForm.get('password')?.valueChanges.subscribe(password => {
      this.updatePasswordValidation(password);
    });
  }

  /**
   * Custom password validator
   */
  passwordValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.value;
    
    if (!password) {
      return null;
    }

    const hasNumber = /[0-9]/.test(password);
    const hasUpper = /[A-Z]/.test(password);
    const hasLower = /[a-z]/.test(password);
    const isLengthValid = password.length >= 8;

    const passwordValid = hasNumber && hasUpper && hasLower && isLengthValid;

    return !passwordValid ? { passwordStrength: true } : null;
  }

  /**
   * Validator to check if passwords match
   */
  passwordMatchValidator(control: AbstractControl): ValidationErrors | null {
    const password = control.get('password');
    const confirmPassword = control.get('confirmPassword');

    if (!password || !confirmPassword) {
      return null;
    }

    return password.value === confirmPassword.value ? null : { passwordMismatch: true };
  }

  /**
   * Update password validation flags for UI feedback
   */
  updatePasswordValidation(password: string): void {
    this.hasMinLength = password.length >= 8;
    this.hasUpperCase = /[A-Z]/.test(password);
    this.hasLowerCase = /[a-z]/.test(password);
    this.hasNumber = /[0-9]/.test(password);
  }

  /**
   * Submit registration form
   */
  onSubmit(): void {
    if (this.registerForm.invalid) {
      // Mark all fields as touched to show errors
      Object.keys(this.registerForm.controls).forEach(key => {
        this.registerForm.get(key)?.markAsTouched();
      });
      return;
    }

    this.loading = true;
    this.errorMessage = '';
    this.successMessage = '';

    // Prepare user data (remove confirmPassword)
    const { confirmPassword, ...userData } = this.registerForm.value;

    this.authService.register(userData).subscribe({
      next: (user) => {
        this.loading = false;
        this.successMessage = '¡Cuenta creada exitosamente! Redirigiendo al login...';
        
        // Redirect to login after 2 seconds
        setTimeout(() => {
          this.router.navigate(['/login']);
        }, 2000);
      },
      error: (error) => {
        this.loading = false;
        
        // Handle specific error messages
        if (error.error?.detail) {
          if (error.error.detail.includes('Email')) {
            this.errorMessage = 'Este email ya está registrado';
          } else if (error.error.detail.includes('Username')) {
            this.errorMessage = 'Este usuario ya está en uso';
          } else {
            this.errorMessage = error.error.detail;
          }
        } else {
          this.errorMessage = 'Error al crear la cuenta. Inténtalo de nuevo.';
        }
      }
    });
  }
}