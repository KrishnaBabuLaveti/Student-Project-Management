function deleteItem(basePath, itemId, redirectPath) {
    if (confirm('Are you sure you want to delete this item?')) {
        fetch(`${basePath}/${itemId}`, {
            method: 'DELETE',
            headers: {
                'Content-Type': 'application/json'
            }
        })
        .then(response => response.json())
        .then(data => {
            if (data.success) {
                window.location.href = redirectPath;
            } else {
                alert('Error deleting item: ' + (data.error || 'Unknown error'));
            }
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Error deleting item. Please try again.');
        });
    }
} 