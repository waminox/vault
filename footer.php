<form method="post" action="_logout.php" id="logoutform" style="display:none;">
</form>

<script type="text/javascript">
  function uuidv4() {
    return ([1e7]+-1e3+-4e3+-8e3+-1e11).replace(/[018]/g, c =>
      (c ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> c / 4).toString(16)
    );
  }
  $(document).ready(() => {

    /* $('#aniimated-thumbnials').lightGallery({

    //   thumbnail:true

    // }); */

    const $lg = $("#aniimated-thumbnials");
      $lg.lightGallery({
        thumbnail:true
      });
      const lgData = $lg.data('lightGallery');
      const deleteIcon = '<span id="lg-delete" class="lg-icon lg-delete"><svg width="24px" height="24px" class="v1262d JUQOtc" viewBox="0 0 24 24"><path d="M15 4V3H9v1H4v2h1v13c0 1.1.9 2 2 2h10c1.1 0 2-.9 2-2V6h1V4h-5zm2 15H7V6h10v13zM9 8h2v9H9zm4 0h2v9h-2z"></path></svg><span>';

      $lg.on("onAfterOpen.lg", ()=> {
      const currImgUrl = lgData.$outer.find('.lg-current').find('.lg-image').attr('src');
      lgData.$outer.find('.lg-toolbar').append(deleteIcon);
        $('#lg-delete').on('click', ()=>{
          if (confirm("Sure to delete " + currImgUrl + " ?") == true) {
              $.ajax({
              url:"functions.php",
              type: "post",    
              dataType: 'json',
              data: {action: 'delete', imgUrl: currImgUrl},
              success:function(result){
                  alert(result.message);
                  location.reload();
              }
            });
          }
        });
      });

    $('.newCache').on('click', function(e){
      e.preventDefault();
      if(document.location.href.includes('?')) {
        var url = document.location.href+"&ver=" + uuidv4();
      }else{
        var url = document.location.href+"?ver=" + uuidv4();
      }
      document.location = url;
    });
  });

</script>


<script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.min.js" integrity="sha384-B4gt1jrGC7Jh4AgTPSdUtOBvfO8shuf57BaghqFfPlYxofvL8/KUEfYiJOMMV+rV" crossorigin="anonymous"></script>

<script src="https://stackpath.bootstrapcdn.com/bootstrap/4.5.2/js/bootstrap.bundle.min.js" integrity="sha384-LtrjvnR4Twt/qOuYxE721u19sVFLVSA4hf/rRt6PrZTmiPltdZcI7q7PXQBYTKyf" crossorigin="anonymous"></script>

<script>
$(document).ready(function(){
    // Get 'type' from URL
    var currentType = new URLSearchParams(window.location.search).get('type');

    // Default to 'image' if 'type' is not defined
    if (!currentType) {
        currentType = 'images';
    }

    // Iterate over each '.nav-link' element
    $('.nav-link').each(function() {
        var linkType = new URL($(this).attr('href'), window.location.origin).searchParams.get('type');
        if (linkType === currentType) {
            // Apply bold style or add class
            $(this).addClass('active-link');
        }
    });
    $('#page_container').addClass('blur');
});
</script>
<script>
document.getElementById('toggleBlur').addEventListener('click', function() {
  document.getElementById('page_container').classList.toggle('blur');
    // If you're toggling the blur on a specific container, replace 'document.body' with a querySelector targeting that container
});
</script>

</body>

</html>