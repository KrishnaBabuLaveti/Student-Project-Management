let alertQueue = []; // Queue to manage alerts
let alertVisible = false; // Flag to track alert visibility

// Function to show alerts from the queue
function showAlert() {
    if (alertQueue.length > 0 && !alertVisible) {
        alertVisible = true; // Set flag to true when an alert is visible
        const alert = alertQueue.shift(); // Get the next alert from the queue
        const bsAlert = new bootstrap.Alert(alert);
        bsAlert.close();

        // Dismiss the alert after 5 seconds
        setTimeout(function() {
            alertVisible = false; // Reset flag after alert is closed
            showAlert(); // Show the next alert in the queue
        }, 5000);
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const alerts = document.querySelectorAll('.alert');
    alerts.forEach(function(alert) {
        alertQueue.push(alert); // Add alerts to the queue
    });
    showAlert(); // Start showing alerts
});


// File upload preview
document.addEventListener('change', function(e) {
    if (e.target && e.target.classList.contains('custom-file-input')) {
        const fileName = e.target.files[0].name;
        const label = e.target.nextElementSibling;
        label.textContent = fileName;
    }
});

// Form validation
function validateForm(formId) {
    const form = document.getElementById(formId);
    if (!form) return true;

    let isValid = true;
    const requiredFields = form.querySelectorAll('[required]');

    requiredFields.forEach(field => {
        if (!field.value.trim()) {
            field.classList.add('is-invalid');
            isValid = false;
        } else {
            field.classList.remove('is-invalid');
        }
    });

    return isValid;
}

// Password match validation
function validatePasswords() {
    const password = document.getElementById('password');
    const password2 = document.getElementById('password2');
    
    if (password && password2) {
        if (password.value !== password2.value) {
            password2.setCustomValidity("Passwords don't match");
        } else {
            password2.setCustomValidity('');
        }
    }
}

// AJAX delete request with confirmation
function deleteItem(url, itemId, redirectUrl) {
    if (confirm('Are you sure you want to delete this item?')) {
        fetch(url + '/' + itemId, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = redirectUrl;
            } else {
                alert('Error deleting item');
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error deleting item');
        });
    }
}

// Date formatting
function formatDate(dateString) {
    const options = { 
        year: 'numeric', 
        month: 'long', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
    };
    return new Date(dateString).toLocaleDateString('en-US', options);
}

// File size validation
function validateFileSize(input, maxSize) {
    const file = input.files[0];
    if (file && file.size > maxSize) {
        alert(`File size must be less than ${Math.round(maxSize/1024/1024)}MB`);
        input.value = '';
        return false;
    }
    return true;
}

// Dynamic form fields toggle
function toggleFields(selectElement, targetFields) {
    const selectedValue = selectElement.value;
    Object.keys(targetFields).forEach(key => {
        const element = document.getElementById(targetFields[key]);
        if (element) {
            element.style.display = key === selectedValue ? 'block' : 'none';
        }
    });
}
